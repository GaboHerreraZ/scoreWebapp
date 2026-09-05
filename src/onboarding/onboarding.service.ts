import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ParametersRepository } from '../parameters/parameters.repository.js';
import { OnboardingDto } from './dto/onboarding.dto.js';
import {
  defaultWeightsFor,
  type PersonTypeCode,
} from '../scoring/scoring.constants.js';
import { PAYMENT_CAPACITY_DEFAULT_WEIGHTS } from '../payment-capacity/engine/payment-capacity.constants.js';
import { FiscalProfileValidator } from '../e-invoicing/fiscal-profile.validator.js';
import { isLegalEntityDocument } from '../e-invoicing/domain/dian.catalogs.js';
import { SalesService } from '../sales/sales.service.js';

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parametersRepository: ParametersRepository,
    private readonly fiscalProfileValidator: FiscalProfileValidator,
    private readonly salesService: SalesService,
  ) {}

  /**
   * Alta de un cliente que se autorregistra: crea Profile (mínimo: nombre,
   * apellido y cargo) + Company (solo nombre + facturación) + UserCompany (rol
   * administrator), todo en una transacción. El NIT, sector, ciudad, dirección
   * y representante legal se completan después en la app. NO toca ePayco: el
   * pago es un paso posterior (POST companies/:id/analysis-packs/purchase).
   *
   * @param userId id del usuario en Supabase (del token) → PK del Profile.
   * @param email  email del usuario (del token) → email del Profile.
   */
  async onboard(userId: string, email: string, dto: OnboardingDto) {
    // El email es unique en profiles: si OTRO profile (id distinto) ya lo
    // tiene, el upsert por id fallaría con un P2002 críptico. Se valida antes
    // para devolver un error claro.
    const emailOwner = await this.prisma.profile.findUnique({
      where: { email },
      select: { id: true },
    });
    if (emailOwner && emailOwner.id !== userId) {
      throw new ConflictException(
        `El correo ${email} ya existe en el sistema asociado a otro perfil.`,
      );
    }

    // Perfil fiscal: los parámetros enviados deben existir y ser del tipo
    // correcto. Sin esto, la factura electrónica la rechaza la DIAN después.
    await this.fiscalProfileValidator.validateSelection({
      billingRegimeTypeId: dto.billing.billingRegimeTypeId,
      billingFiscalResponsibilities: dto.billing.billingFiscalResponsibilities,
    });

    const adminRole = await this.parametersRepository.findByTypeAndCode(
      'user_company_role',
      'administrator',
    );
    if (!adminRole) {
      throw new BadRequestException(
        'Falta el parámetro de rol administrator (user_company_role)',
      );
    }

    // Tipos de persona y de estudio: se crea una config de scoring default por
    // cada combinación válida (EEFF: PJ y PN; capacidad de pago: solo PN).
    const [naturalPerson, legalEntity, eeffStudyType, capacityStudyType] =
      await Promise.all([
        this.parametersRepository.findByTypeAndCode(
          'person_type',
          'naturalPerson',
        ),
        this.parametersRepository.findByTypeAndCode(
          'person_type',
          'legalEntity',
        ),
        this.parametersRepository.findByTypeAndCode(
          'study_type',
          'financialStatements',
        ),
        this.parametersRepository.findByTypeAndCode(
          'study_type',
          'paymentCapacity',
        ),
      ]);
    if (!naturalPerson || !legalEntity) {
      throw new BadRequestException(
        'Faltan los parámetros person_type (naturalPerson / legalEntity)',
      );
    }
    if (!eeffStudyType || !capacityStudyType) {
      throw new BadRequestException(
        'Faltan los parámetros study_type (financialStatements / paymentCapacity)',
      );
    }

    // Vendedor que recomendó Creditia (opcional). Se resuelve ANTES de la
    // transacción: si el código está mal, el cliente lo corrige en el formulario
    // en lugar de quedarse creyendo que le dio el crédito a su referidor.
    const referral = dto.salesRepCode?.trim()
      ? await this.salesService.resolveCodeForOnboarding(dto.salesRepCode)
      : null;

    // El wizard ya no pide documento ni teléfono del usuario: si la facturación
    // es de persona natural, ese documento/teléfono son de la persona y se
    // siembran en el perfil (sin pisar lo que ya tenga).
    const billingDocType = await this.parametersRepository.findById(
      dto.billing.billingDocTypeId,
    );
    const isPersonalDoc =
      billingDocType != null && !isLegalEntityDocument(billingDocType.code);
    const existingProfile = await this.prisma.profile.findUnique({
      where: { id: userId },
      select: {
        identificationTypeId: true,
        identificationNumber: true,
        phone: true,
      },
    });
    const identificationTypeId =
      existingProfile?.identificationTypeId ??
      (isPersonalDoc ? dto.billing.billingDocTypeId : undefined);
    const identificationNumber =
      existingProfile?.identificationNumber ??
      (isPersonalDoc ? dto.billing.billingDocNumber : undefined);
    const phone =
      existingProfile?.phone ??
      (isPersonalDoc ? dto.billing.billingPhone : undefined);

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Profile (upsert: el usuario de Supabase ya existe; si ya tenía
      //    Profile se actualizan sus datos, si no se crea).
      const profile = await tx.profile.upsert({
        where: { id: userId },
        create: {
          id: userId,
          email,
          name: dto.profile.name,
          lastName: dto.profile.lastName,
          phone,
          roleId: adminRole.id, // dueño que se autorregistra = administrator
          identificationTypeId,
          identificationNumber,
          position: dto.profile.position,
        },
        update: {
          name: dto.profile.name,
          lastName: dto.profile.lastName,
          phone,
          roleId: adminRole.id,
          identificationTypeId,
          identificationNumber,
          position: dto.profile.position,
        },
      });

      // 2. Company mínima (solo nombre) + facturación. El resto se difiere.
      const company = await tx.company.create({
        data: {
          name: dto.company.name,
          billingName: dto.billing.billingName,
          billingLastName: dto.billing.billingLastName,
          billingBusinessName: dto.billing.billingBusinessName,
          billingDocTypeId: dto.billing.billingDocTypeId,
          billingDocNumber: dto.billing.billingDocNumber,
          billingEmail: dto.billing.billingEmail,
          billingPhone: dto.billing.billingPhone,
          billingAddress: dto.billing.billingAddress,
          billingCityCode: dto.billing.billingCityCode,
          billingRegimeTypeId: dto.billing.billingRegimeTypeId,
          billingFiscalResponsibilities:
            dto.billing.billingFiscalResponsibilities,
        },
      });

      // 2b. Vinculación con el vendedor, con los % del plan congelados. Va
      //     dentro de la transacción: si el alta falla, no queda una empresa
      //     fantasma atribuida a nadie.
      if (referral) {
        await tx.companyReferral.create({
          data: {
            companyId: company.id,
            salesRepId: referral.salesRepId,
            commissionPlanId: referral.commissionPlanId,
            newCustomerPercent: referral.newCustomerPercent,
            recurringPercent: referral.recurringPercent,
            notes: 'Código ingresado por el cliente en el registro',
          },
        });
      }

      // 3. UserCompany: el usuario es administrator (dueño) de su empresa.
      const userCompany = await tx.userCompany.create({
        data: {
          userId: profile.id,
          companyId: company.id,
          roleId: adminRole.id,
          isActive: true,
          joinedAt: new Date(),
        },
      });

      // 4. ScoringConfiguration v1 por combinación (tipo de persona, tipo de
      //    estudio) con las dimensiones default del sistema y sus pesos. Toda
      //    empresa nace con las 3 configs vigentes (EEFF-PJ, EEFF-PN y
      //    capacidad-PN) para que el análisis funcione sin obligar a
      //    configurar; después puede reconfigurar cada una.
      const dimensions = await tx.scoringDimension.findMany({
        where: { isActive: true },
      });
      const dimensionIdByCode = new Map(dimensions.map((d) => [d.code, d.id]));
      const weightRows = (defaults: Partial<Record<string, number>>) =>
        Object.entries(defaults).flatMap(([code, weight]) => {
          const dimensionId = dimensionIdByCode.get(code);
          // Dimensión default ausente del catálogo (no debería pasar: el seed
          // de la migración las crea): se omite en vez de romper el onboarding.
          return dimensionId && weight !== undefined
            ? [{ dimensionId, weight }]
            : [];
        });
      const defaultWeightRows = (personType: PersonTypeCode) =>
        weightRows(defaultWeightsFor(personType));
      await tx.scoringConfiguration.create({
        data: {
          companyId: company.id,
          personTypeId: legalEntity.id,
          studyTypeId: eeffStudyType.id,
          createdBy: profile.id,
          isActive: true,
          weights: { create: defaultWeightRows('legalEntity') },
        },
      });
      await tx.scoringConfiguration.create({
        data: {
          companyId: company.id,
          personTypeId: naturalPerson.id,
          studyTypeId: eeffStudyType.id,
          createdBy: profile.id,
          isActive: true,
          weights: { create: defaultWeightRows('naturalPerson') },
        },
      });
      await tx.scoringConfiguration.create({
        data: {
          companyId: company.id,
          personTypeId: naturalPerson.id,
          studyTypeId: capacityStudyType.id,
          createdBy: profile.id,
          isActive: true,
          weights: { create: weightRows(PAYMENT_CAPACITY_DEFAULT_WEIGHTS) },
        },
      });

      return { profile, company, userCompany };
    });

    return {
      profileId: result.profile.id,
      companyId: result.company.id,
      userCompanyId: result.userCompany.id,
    };
  }

  /**
   * Reconstruye la data de onboarding (profile + company + billing) de un usuario
   * a partir de su profileId. Pensado para reintentar el pago tras un fallo: el
   * front repinta estos datos ya guardados y vuelve a lanzar el purchase sin que
   * el usuario reingrese nada. Devuelve la misma forma del DTO de onboarding,
   * más profileId/companyId para armar la llamada al purchase.
   */
  async getOnboardingData(profileId: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: profileId },
      include: {
        userCompanies: {
          where: { isActive: true },
          orderBy: { joinedAt: 'asc' },
          take: 1,
          include: {
            company: {
              include: {
                daneCity: {
                  select: { name: true, region: { select: { name: true } } },
                },
                billingDaneCity: {
                  select: { name: true, region: { select: { name: true } } },
                },
              },
            },
          },
        },
      },
    });

    if (!profile) {
      throw new NotFoundException(`Perfil con id=${profileId} no encontrado`);
    }

    const company = profile.userCompanies[0]?.company ?? null;
    if (!company) {
      throw new NotFoundException(
        'El perfil no tiene una empresa asociada activa',
      );
    }

    return {
      profileId: profile.id,
      companyId: company.id,
      profile: {
        name: profile.name,
        lastName: profile.lastName,
        phone: profile.phone,
        identificationTypeId: profile.identificationTypeId,
        identificationNumber: profile.identificationNumber,
        position: profile.position,
      },
      company: {
        name: company.name,
        nit: company.nit,
        sectorId: company.sectorId,
        cityCode: company.cityCode,
        // Resueltos para pintar el resumen sin que el front vuelva al catálogo.
        // Nullable: la empresa puede no tener domicilio aún (onboarding mínimo).
        city: company.daneCity?.name ?? null,
        state: company.daneCity?.region.name ?? null,
        address: company.address,
      },
      billing: {
        billingName: company.billingName,
        billingLastName: company.billingLastName,
        billingBusinessName: company.billingBusinessName,
        billingDocTypeId: company.billingDocTypeId,
        billingDocNumber: company.billingDocNumber,
        billingEmail: company.billingEmail,
        billingPhone: company.billingPhone,
        billingAddress: company.billingAddress,
        billingCityCode: company.billingCityCode,
        billingRegimeTypeId: company.billingRegimeTypeId,
        billingFiscalResponsibilities: company.billingFiscalResponsibilities,
        billingCity: company.billingDaneCity?.name ?? null,
        billingState: company.billingDaneCity?.region.name ?? null,
      },
    };
  }
}
