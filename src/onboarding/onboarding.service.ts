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
import { FiscalProfileValidator } from '../e-invoicing/fiscal-profile.validator.js';

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parametersRepository: ParametersRepository,
    private readonly fiscalProfileValidator: FiscalProfileValidator,
  ) {}

  /**
   * Alta de un cliente que se autorregistra: crea Profile (ligado al usuario de
   * Supabase ya autenticado) + Company (con facturación) + UserCompany (rol
   * administrator), todo en una transacción. NO toca ePayco: el pago es un paso
   * posterior (POST companies/:id/analysis-packs/purchase con el packOfferingId).
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

    // Validaciones rápidas antes de la transacción.
    const existingNit = await this.prisma.company.findUnique({
      where: { nit: dto.company.nit },
    });
    if (existingNit) {
      throw new ConflictException(
        `Ya existe una empresa con el NIT ${dto.company.nit}`,
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

    // Tipos de persona: se crea una config de scoring default por cada uno.
    const [naturalPerson, legalEntity] = await Promise.all([
      this.parametersRepository.findByTypeAndCode(
        'person_type',
        'naturalPerson',
      ),
      this.parametersRepository.findByTypeAndCode('person_type', 'legalEntity'),
    ]);
    if (!naturalPerson || !legalEntity) {
      throw new BadRequestException(
        'Faltan los parámetros person_type (naturalPerson / legalEntity)',
      );
    }

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
          phone: dto.profile.phone,
          roleId: adminRole.id, // dueño que se autorregistra = administrator
          identificationTypeId: dto.profile.identificationTypeId,
          identificationNumber: dto.profile.identificationNumber,
          position: dto.profile.position,
        },
        update: {
          name: dto.profile.name,
          lastName: dto.profile.lastName,
          phone: dto.profile.phone,
          roleId: adminRole.id,
          identificationTypeId: dto.profile.identificationTypeId,
          identificationNumber: dto.profile.identificationNumber,
          position: dto.profile.position,
        },
      });

      // 2. Company con facturación.
      const company = await tx.company.create({
        data: {
          name: dto.company.name,
          nit: dto.company.nit,
          sectorId: dto.company.sectorId,
          cityCode: dto.company.cityCode,
          address: dto.company.address,
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

      // 4. ScoringConfiguration v1 por tipo de persona (PN y PJ) con las
      //    dimensiones default del sistema y sus pesos (filas en
      //    scoring_configuration_weights). Toda empresa nace con una config
      //    vigente por tipo para que el análisis funcione sin obligar a
      //    configurar; después puede reconfigurar cada una (habilitar/
      //    deshabilitar dimensiones opcionales, ajustar pesos). PN y PJ tienen
      //    defaults distintos (en PN no aplica veracidad; pesa más la central).
      const dimensions = await tx.scoringDimension.findMany({
        where: { isActive: true },
      });
      const dimensionIdByCode = new Map(dimensions.map((d) => [d.code, d.id]));
      const defaultWeightRows = (personType: PersonTypeCode) => {
        const defaults = defaultWeightsFor(personType);
        return Object.entries(defaults).flatMap(([code, weight]) => {
          const dimensionId = dimensionIdByCode.get(code);
          // Dimensión default ausente del catálogo (no debería pasar: el seed
          // de la migración las crea): se omite en vez de romper el onboarding.
          return dimensionId ? [{ dimensionId, weight }] : [];
        });
      };
      await tx.scoringConfiguration.create({
        data: {
          companyId: company.id,
          personTypeId: legalEntity.id,
          createdBy: profile.id,
          isActive: true,
          weights: { create: defaultWeightRows('legalEntity') },
        },
      });
      await tx.scoringConfiguration.create({
        data: {
          companyId: company.id,
          personTypeId: naturalPerson.id,
          createdBy: profile.id,
          isActive: true,
          weights: { create: defaultWeightRows('naturalPerson') },
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
        city: company.daneCity.name,
        state: company.daneCity.region.name,
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
