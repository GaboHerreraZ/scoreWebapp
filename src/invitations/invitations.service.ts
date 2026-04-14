import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { InvitationsRepository } from './invitations.repository.js';
import { MailService } from '../mail/mail.service.js';
import { CreateInvitationDto } from './dto/create-invitation.dto.js';
import { RespondInvitationDto } from './dto/respond-invitation.dto.js';
import { FilterInvitationDto } from './dto/filter-invitation.dto.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class InvitationsService {
  constructor(
    private readonly repository: InvitationsRepository,
    private readonly mailService: MailService,
  ) {}

  async create(companyId: string, invitedBy: string, dto: CreateInvitationDto) {
    const companyExists = await this.repository.companyExists(companyId);
    if (!companyExists) {
      throw new NotFoundException(
        `La empresa con id=${companyId} no fue encontrada`,
      );
    }

    // Obtener el parámetro de rol "invited"
    const invitedRoleId = await this.repository.getRoleId('invitado');
    if (!invitedRoleId) {
      throw new BadRequestException(
        'No se encontró el parámetro de rol "invited". Cree un parámetro con type=user_company_role, code=invitado',
      );
    }

    // Verificar si el usuario ya pertenece a la empresa
    const alreadyInCompany = await this.repository.userAlreadyInCompany(
      dto.email,
      companyId,
    );
    if (alreadyInCompany) {
      throw new ConflictException('Este usuario ya es miembro de esta empresa');
    }

    // Obtener el ID del estado "pending"
    const pendingStatusId =
      await this.repository.getInvitationStatusId('pending');
    if (!pendingStatusId) {
      throw new BadRequestException(
        'No se encontró el parámetro de estado "pendiente". Cree parámetros con type=invitation_status',
      );
    }

    // Verificar si ya existe una invitación pendiente para este correo en esta empresa
    const existingPending = await this.repository.findPendingByEmailAndCompany(
      dto.email,
      companyId,
      pendingStatusId,
    );
    if (existingPending) {
      throw new ConflictException(
        'Ya existe una invitación pendiente para este correo en esta empresa',
      );
    }

    // Validar límite de suscripción (usuarios activos + invitaciones pendientes)
    const maxUsers = await this.repository.getCompanyMaxUsers(companyId);
    if (maxUsers === null) {
      throw new BadRequestException(
        'Esta empresa no tiene una suscripción activa',
      );
    }

    const [activeUsersCount, pendingInvitationsCount] = await Promise.all([
      this.repository.getCompanyActiveUsersCount(companyId),
      this.repository.getCompanyPendingInvitationsCount(
        companyId,
        pendingStatusId,
      ),
    ]);

    if (activeUsersCount + pendingInvitationsCount >= maxUsers) {
      throw new ForbiddenException(
        `La empresa ha alcanzado el número máximo de usuarios permitidos por su suscripción (${maxUsers}). Actualice su plan para invitar más usuarios.`,
      );
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // Expira en 7 días

    // Verificar si existe una invitación rechazada para reactivarla
    const rejectedStatusId =
      await this.repository.getInvitationStatusId('rejected');

    let invitation;

    if (rejectedStatusId) {
      const existingRejected =
        await this.repository.findInactiveByEmailAndCompany(
          dto.email,
          companyId,
          [rejectedStatusId],
        );

      if (existingRejected) {
        // Reactivar la invitación existente
        invitation = await this.repository.update(existingRejected.id, {
          statusId: pendingStatusId,
          token,
          expiresAt,
          invitedBy,
          roleId: invitedRoleId,
          respondedAt: null,
        });

        // Si el profile existe y no tiene UserCompany, crearlo inactivo
        const profile = await this.repository.profileExistsByEmail(dto.email);
        if (profile) {
          const alreadyHasUC = await this.repository.userAlreadyInCompany(
            dto.email,
            companyId,
          );
          if (!alreadyHasUC) {
            await this.repository.createUserCompanyInactive(
              profile.id,
              companyId,
              invitedRoleId,
              invitedBy,
            );
          }
        }

        // Enviar correo
        const invitedByUser = invitation.invitedByUser as {
          name?: string | null;
          lastName?: string | null;
        };
        const invitedByName =
          [invitedByUser.name, invitedByUser.lastName]
            .filter(Boolean)
            .join(' ') || 'Un usuario';

        await this.mailService.sendInvitationEmail({
          to: dto.email,
          invitationId: invitation.id,
          token,
          companyName: invitation.company.name,
          invitedByName,
        });

        return invitation;
      }
    }

    // Crear nueva invitación
    const invitationData = {
      companyId,
      invitedBy,
      email: dto.email,
      roleId: invitedRoleId,
      statusId: pendingStatusId,
      token,
      expiresAt,
    };

    const profile = await this.repository.profileExistsByEmail(dto.email);
    if (profile) {
      invitation = await this.repository.createWithUserCompany(invitationData, {
        userId: profile.id,
        companyId,
        roleId: invitedRoleId,
        invitedBy,
      });
    } else {
      invitation = await this.repository.create(invitationData);
    }

    // Enviar correo de invitación
    const invitedByUser = invitation.invitedByUser as {
      name?: string | null;
      lastName?: string | null;
    };
    const invitedByName =
      [invitedByUser.name, invitedByUser.lastName].filter(Boolean).join(' ') ||
      'Un usuario';

    await this.mailService.sendInvitationEmail({
      to: dto.email,
      invitationId: invitation.id,
      token,
      companyName: invitation.company.name,
      invitedByName,
    });

    return invitation;
  }

  async findAllByCompany(companyId: string, filters: FilterInvitationDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const skip = (page - 1) * limit;

    const where: Prisma.InvitationWhereInput = { companyId };

    if (filters.statusId !== undefined) {
      where.statusId = filters.statusId;
    }

    if (filters.search) {
      where.email = { contains: filters.search, mode: 'insensitive' };
    }

    const { data, total } = await this.repository.findAll({
      skip,
      take: limit,
      where,
      orderBy: { createdAt: 'desc' },
    });

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findPendingByEmail(email: string) {
    const pendingStatusId =
      await this.repository.getInvitationStatusId('pending');
    if (!pendingStatusId) {
      throw new BadRequestException(
        'No se encontró el parámetro de estado "pending"',
      );
    }

    const invitation = await this.repository.findPendingByEmail(
      email,
      pendingStatusId,
    );

    return {
      hasPendingInvitation: !!invitation,
      invitation,
    };
  }

  async findById(id: string) {
    const invitation = await this.repository.findById(id);
    if (!invitation) {
      throw new NotFoundException(
        `La invitación con id=${id} no fue encontrada`,
      );
    }
    return invitation;
  }

  async findByIdPublic(id: string, token: string) {
    const invitation = await this.repository.findByIdAndToken(id, token);
    if (!invitation) {
      throw new NotFoundException('Invitación no encontrada o token inválido');
    }

    if (new Date() > invitation.expiresAt) {
      throw new BadRequestException('Esta invitación ha expirado');
    }

    return invitation;
  }

  async findAllByUser(userId: string, filters: FilterInvitationDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const skip = (page - 1) * limit;

    const where: Prisma.InvitationWhereInput = { invitedBy: userId };

    if (filters.statusId !== undefined) {
      where.statusId = filters.statusId;
    }

    if (filters.search) {
      where.email = { contains: filters.search, mode: 'insensitive' };
    }

    const { data, total } = await this.repository.findAllByInvitedBy({
      skip,
      take: limit,
      where,
      orderBy: { createdAt: 'desc' },
    });

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async acceptAndRegister(invitationId: string, userId: string, token: string) {
    const invitation = await this.repository.findByIdAndToken(
      invitationId,
      token,
    );
    if (!invitation) {
      throw new NotFoundException('Invitación no encontrada o token inválido');
    }

    if (new Date() > invitation.expiresAt) {
      throw new BadRequestException('Esta invitación ha expirado');
    }

    // Verificar que la invitación esté pendiente
    const pendingStatusId =
      await this.repository.getInvitationStatusId('pending');
    if (invitation.statusId !== pendingStatusId) {
      throw new BadRequestException('Esta invitación ya fue respondida');
    }

    // Verificar que no exista ya un profile con este userId
    const profileExists = await this.repository.profileExistsById(userId);
    if (profileExists) {
      throw new ConflictException('Ya existe un perfil con este userId');
    }

    // Verificar que no exista un profile con este email
    const emailExists = await this.repository.profileExistsByEmail(
      invitation.email,
    );
    if (emailExists) {
      throw new ConflictException(
        'Ya existe un perfil con este correo electrónico',
      );
    }

    const acceptedStatusId =
      await this.repository.getInvitationStatusId('accepted');
    if (!acceptedStatusId) {
      throw new BadRequestException(
        'No se encontró el parámetro de estado "aceptada"',
      );
    }

    // Obtener el rol "auxiliar" para asignar al usuario aceptado
    const auxiliarRoleId = await this.repository.getRoleId('assistant');
    if (!auxiliarRoleId) {
      throw new BadRequestException(
        'No se encontró el parámetro de rol "auxiliar". Cree un parámetro con type=user_company_role, code=auxiliar',
      );
    }

    // Re-validar límite de suscripción
    const maxUsers = await this.repository.getCompanyMaxUsers(
      invitation.companyId,
    );
    if (maxUsers !== null) {
      const activeUsersCount = await this.repository.getCompanyActiveUsersCount(
        invitation.companyId,
      );
      if (activeUsersCount >= maxUsers) {
        throw new ForbiddenException(
          'La empresa ha alcanzado el número máximo de usuarios permitidos por su suscripción. No se puede aceptar la invitación en este momento.',
        );
      }
    }

    return this.repository.acceptInvitationAndRegister({
      invitationId,
      userId,
      email: invitation.email,
      companyId: invitation.companyId,
      roleId: auxiliarRoleId,
      acceptedStatusId,
      invitedBy: invitation.invitedBy,
    });
  }

  async rejectPublic(id: string, token: string) {
    const invitation = await this.repository.findByIdAndToken(id, token);
    if (!invitation) {
      throw new NotFoundException('Invitación no encontrada o token inválido');
    }

    if (new Date() > invitation.expiresAt) {
      throw new BadRequestException('Esta invitación ha expirado');
    }

    const pendingStatusId =
      await this.repository.getInvitationStatusId('pending');
    if (invitation.statusId !== pendingStatusId) {
      throw new BadRequestException('Esta invitación ya fue respondida');
    }

    const rejectedStatusId =
      await this.repository.getInvitationStatusId('rejected');
    if (!rejectedStatusId) {
      throw new BadRequestException(
        'No se encontró el parámetro de estado "rejected"',
      );
    }

    // Eliminar UserCompany inactivo si existe
    await this.repository.cancelInvitation(
      id,
      rejectedStatusId,
      invitation.email,
      invitation.companyId,
    );
  }

  async toggleUserStatus(id: string, isActive: boolean) {
    const invitation = await this.repository.findById(id);
    if (!invitation) {
      throw new NotFoundException(
        `La invitación con id=${id} no fue encontrada`,
      );
    }

    // Solo se puede activar/desactivar invitaciones aceptadas o canceladas
    const acceptedStatusId =
      await this.repository.getInvitationStatusId('accepted');
    const cancelledStatusId =
      await this.repository.getInvitationStatusId('canceled');
    const allowedStatuses = [acceptedStatusId, cancelledStatusId].filter(
      (id): id is number => id !== null,
    );

    if (!allowedStatuses.includes(invitation.statusId)) {
      throw new BadRequestException(
        'Solo se puede activar o desactivar usuarios con invitaciones aceptadas o canceladas',
      );
    }

    // Actualizar isActive del UserCompany asociado
    const profile = await this.repository.profileExistsByEmail(
      invitation.email,
    );
    if (!profile) {
      throw new NotFoundException(
        'No se encontró el perfil del usuario invitado',
      );
    }

    await this.repository.updateUserCompanyStatus(
      profile.id,
      invitation.companyId,
      isActive,
    );

    // Si se desactiva, cambiar invitación a cancelled y enviar correo
    if (!isActive) {
      const cancelledStatusId =
        await this.repository.getInvitationStatusId('canceled');
      if (cancelledStatusId) {
        await this.repository.update(id, { statusId: cancelledStatusId });
      }

      await this.mailService.sendUserDeactivatedEmail({
        to: invitation.email,
        companyName: invitation.company.name,
      });
    } else {
      // Si se reactiva, volver a estado accepted
      await this.repository.update(id, { statusId: acceptedStatusId! });
    }

    return this.repository.findById(id);
  }

  async respond(
    id: string,
    userId: string,
    userEmail: string,
    dto: RespondInvitationDto,
  ) {
    const invitation = await this.repository.findById(id);
    if (!invitation) {
      throw new NotFoundException(
        `La invitación con id=${id} no fue encontrada`,
      );
    }

    // Verificar que la invitación pertenece al email del usuario autenticado
    if (invitation.email.toLowerCase() !== userEmail.toLowerCase()) {
      throw new ForbiddenException('Esta invitación no te pertenece');
    }

    // Verificar que aún esté pendiente
    const pendingStatusId =
      await this.repository.getInvitationStatusId('pending');
    if (invitation.statusId !== pendingStatusId) {
      throw new BadRequestException('Esta invitación ya fue respondida');
    }

    if (dto.accept) {
      const acceptedStatusId =
        await this.repository.getInvitationStatusId('accepted');
      if (!acceptedStatusId) {
        throw new BadRequestException(
          'No se encontró el parámetro de estado "accepted"',
        );
      }

      // Obtener el rol "auxiliar" para asignar al usuario aceptado
      const auxiliarRoleId = await this.repository.getRoleId('assistant');
      if (!auxiliarRoleId) {
        throw new BadRequestException(
          'No se encontró el parámetro de rol "auxiliar". Cree un parámetro con type=user_company_role, code=auxiliar',
        );
      }

      // Re-validar límite de suscripción al momento de aceptar
      const maxUsers = await this.repository.getCompanyMaxUsers(
        invitation.companyId,
      );
      if (maxUsers !== null) {
        const activeUsersCount =
          await this.repository.getCompanyActiveUsersCount(
            invitation.companyId,
          );
        if (activeUsersCount >= maxUsers) {
          throw new ForbiddenException(
            'La empresa ha alcanzado el número máximo de usuarios permitidos por su suscripción. No se puede aceptar la invitación en este momento.',
          );
        }
      }

      return this.repository.acceptInvitation(
        id,
        userId,
        invitation.companyId,
        auxiliarRoleId,
        acceptedStatusId,
      );
    } else {
      const rejectedStatusId =
        await this.repository.getInvitationStatusId('rejected');
      if (!rejectedStatusId) {
        throw new BadRequestException(
          'No se encontró el parámetro de estado "rejected"',
        );
      }

      return this.repository.update(id, {
        statusId: rejectedStatusId,
        respondedAt: new Date(),
      });
    }
  }
}
