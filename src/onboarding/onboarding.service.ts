import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ParametersRepository } from '../parameters/parameters.repository.js';
import { OnboardingDto } from './dto/onboarding.dto.js';

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parametersRepository: ParametersRepository,
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
    // Validaciones rápidas antes de la transacción.
    const existingNit = await this.prisma.company.findUnique({
      where: { nit: dto.company.nit },
    });
    if (existingNit) {
      throw new ConflictException(
        `Ya existe una empresa con el NIT ${dto.company.nit}`,
      );
    }

    const adminRole = await this.parametersRepository.findByTypeAndCode(
      'user_company_role',
      'administrator',
    );
    if (!adminRole) {
      throw new BadRequestException(
        'Falta el parámetro de rol administrator (user_company_role)',
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
          identificationTypeId: dto.profile.identificationTypeId,
          identificationNumber: dto.profile.identificationNumber,
          position: dto.profile.position,
        },
        update: {
          name: dto.profile.name,
          lastName: dto.profile.lastName,
          phone: dto.profile.phone,
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
          state: dto.company.state,
          city: dto.company.city,
          address: dto.company.address,
          billingName: dto.billing.billingName,
          billingLastName: dto.billing.billingLastName,
          billingDocTypeId: dto.billing.billingDocTypeId,
          billingDocNumber: dto.billing.billingDocNumber,
          billingEmail: dto.billing.billingEmail,
          billingPhone: dto.billing.billingPhone,
          billingAddress: dto.billing.billingAddress,
          billingState: dto.billing.billingState,
          billingCity: dto.billing.billingCity,
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
          include: { company: true },
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
        state: company.state,
        city: company.city,
        address: company.address,
      },
      billing: {
        billingName: company.billingName,
        billingLastName: company.billingLastName,
        billingDocTypeId: company.billingDocTypeId,
        billingDocNumber: company.billingDocNumber,
        billingEmail: company.billingEmail,
        billingPhone: company.billingPhone,
        billingAddress: company.billingAddress,
        billingState: company.billingState,
        billingCity: company.billingCity,
      },
    };
  }
}
