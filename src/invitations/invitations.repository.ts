import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class InvitationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private readonly defaultInclude = {
    company: true,
    invitedByUser: {
      select: { id: true, name: true, lastName: true, email: true },
    },
    status: true,
  };

  async create(data: Prisma.InvitationUncheckedCreateInput) {
    return this.prisma.invitation.create({
      data,
      include: this.defaultInclude,
    });
  }

  async createWithUserCompany(
    invitationData: Prisma.InvitationUncheckedCreateInput,
    userCompanyData: {
      userId: string;
      companyId: string;
      roleId: number;
      invitedBy: string;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const invitation = await tx.invitation.create({
        data: invitationData,
        include: this.defaultInclude,
      });

      await tx.userCompany.create({
        data: {
          userId: userCompanyData.userId,
          companyId: userCompanyData.companyId,
          roleId: userCompanyData.roleId,
          invitedBy: userCompanyData.invitedBy,
          isActive: false,
        },
      });

      return invitation;
    });
  }

  async findAll(params: {
    skip: number;
    take: number;
    where?: Prisma.InvitationWhereInput;
    orderBy?: Prisma.InvitationOrderByWithRelationInput;
  }) {
    const { skip, take, where, orderBy } = params;

    const [data, total] = await Promise.all([
      this.prisma.invitation.findMany({
        skip,
        take,
        where,
        orderBy,
        include: this.defaultInclude,
      }),
      this.prisma.invitation.count({ where }),
    ]);

    return { data, total };
  }

  async findById(id: string) {
    return this.prisma.invitation.findUnique({
      where: { id },
      include: this.defaultInclude,
    });
  }

  async findByIdAndToken(id: string, token: string) {
    return this.prisma.invitation.findFirst({
      where: { id, token },
      include: this.defaultInclude,
    });
  }

  async findInactiveByEmailAndCompany(
    email: string,
    companyId: string,
    statusIds: number[],
  ) {
    return this.prisma.invitation.findFirst({
      where: { email, companyId, statusId: { in: statusIds } },
      include: this.defaultInclude,
    });
  }

  async findPendingByEmailAndCompany(
    email: string,
    companyId: string,
    pendingStatusId: number,
  ) {
    return this.prisma.invitation.findFirst({
      where: { email, companyId, statusId: pendingStatusId },
    });
  }

  async findPendingByEmail(email: string, pendingStatusId: number) {
    return this.prisma.invitation.findFirst({
      where: { email, statusId: pendingStatusId },
      include: this.defaultInclude,
    });
  }

  async update(id: string, data: Prisma.InvitationUncheckedUpdateInput) {
    return this.prisma.invitation.update({
      where: { id },
      data,
      include: this.defaultInclude,
    });
  }

  async getCompanyActiveUsersCount(companyId: string): Promise<number> {
    return this.prisma.userCompany.count({
      where: { companyId, isActive: true },
    });
  }

  async getCompanyPendingInvitationsCount(
    companyId: string,
    pendingStatusId: number,
  ): Promise<number> {
    return this.prisma.invitation.count({
      where: { companyId, statusId: pendingStatusId },
    });
  }

  async getCompanyMaxUsers(companyId: string): Promise<number | null> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: {
        companySubscriptions: {
          where: { isCurrent: true },
          take: 1,
          include: { subscription: true },
        },
      },
    });

    if (!company) return null;
    const currentSub = company.companySubscriptions[0];
    if (!currentSub) return null;

    return currentSub.subscription.maxUsers;
  }

  async getInvitationStatusId(code: string): Promise<number | null> {
    const param = await this.prisma.parameter.findFirst({
      where: { type: 'invitation_status', code },
    });
    return param?.id ?? null;
  }

  async getRoleId(code: string): Promise<number | null> {
    const param = await this.prisma.parameter.findFirst({
      where: { type: 'user_company_role', code },
    });
    return param?.id ?? null;
  }

  async findAllByInvitedBy(params: {
    skip: number;
    take: number;
    where?: Prisma.InvitationWhereInput;
    orderBy?: Prisma.InvitationOrderByWithRelationInput;
  }) {
    const { skip, take, where, orderBy } = params;

    const [data, total] = await Promise.all([
      this.prisma.invitation.findMany({
        skip,
        take,
        where,
        orderBy,
        include: this.defaultInclude,
      }),
      this.prisma.invitation.count({ where }),
    ]);

    return { data, total };
  }

  async delete(id: string) {
    return this.prisma.invitation.delete({ where: { id } });
  }

  async cancelInvitation(
    invitationId: string,
    cancelledStatusId: number,
    email: string,
    companyId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Eliminar físicamente el UserCompany inactivo (si existe), ya que nunca se activó
      const profile = await tx.profile.findUnique({ where: { email } });
      if (profile) {
        const uc = await tx.userCompany.findUnique({
          where: { userId_companyId: { userId: profile.id, companyId } },
        });
        if (uc && !uc.isActive) {
          await tx.userCompany.delete({ where: { id: uc.id } });
        }
      }

      // Borrado lógico: cambiar estado a cancelled
      await tx.invitation.update({
        where: { id: invitationId },
        data: { statusId: cancelledStatusId, respondedAt: new Date() },
      });
    });
  }

  async updateUserCompanyStatus(
    userId: string,
    companyId: string,
    isActive: boolean,
  ) {
    return this.prisma.userCompany.update({
      where: { userId_companyId: { userId, companyId } },
      data: { isActive },
    });
  }

  async createUserCompanyInactive(
    userId: string,
    companyId: string,
    roleId: number,
    invitedBy: string,
  ) {
    return this.prisma.userCompany.create({
      data: { userId, companyId, roleId, invitedBy, isActive: false },
    });
  }

  async companyExists(companyId: string): Promise<boolean> {
    const count = await this.prisma.company.count({ where: { id: companyId } });
    return count > 0;
  }

  async parameterExists(parameterId: number): Promise<boolean> {
    const count = await this.prisma.parameter.count({
      where: { id: parameterId },
    });
    return count > 0;
  }

  async profileExistsByEmail(email: string) {
    return this.prisma.profile.findUnique({ where: { email } });
  }

  async profileExistsById(id: string): Promise<boolean> {
    const count = await this.prisma.profile.count({ where: { id } });
    return count > 0;
  }

  async acceptInvitationAndRegister(params: {
    invitationId: string;
    userId: string;
    email: string;
    companyId: string;
    roleId: number;
    acceptedStatusId: number;
    invitedBy: string;
  }) {
    const {
      invitationId,
      userId,
      email,
      companyId,
      roleId,
      acceptedStatusId,
      invitedBy,
    } = params;

    return this.prisma.$transaction(async (tx) => {
      // Crear profile con datos placeholder
      await tx.profile.create({
        data: {
          id: userId,
          roleId,
          email,
          name: 'Usuario',
          lastName: 'Invitado',
        },
      });

      // Actualizar la invitación a aceptada
      const invitation = await tx.invitation.update({
        where: { id: invitationId },
        data: { statusId: acceptedStatusId, respondedAt: new Date() },
        include: this.defaultInclude,
      });

      // Verificar si ya existe un UserCompany (creado inactivo al invitar)
      const existingUC = await tx.userCompany.findUnique({
        where: { userId_companyId: { userId, companyId } },
      });

      if (existingUC) {
        await tx.userCompany.update({
          where: { id: existingUC.id },
          data: { isActive: true, joinedAt: new Date() },
        });
      } else {
        await tx.userCompany.create({
          data: {
            userId,
            companyId,
            roleId,
            invitedBy,
            isActive: true,
            joinedAt: new Date(),
          },
        });
      }

      return invitation;
    });
  }

  async userAlreadyInCompany(
    email: string,
    companyId: string,
  ): Promise<boolean> {
    const profile = await this.prisma.profile.findUnique({ where: { email } });
    if (!profile) return false;

    const count = await this.prisma.userCompany.count({
      where: { userId: profile.id, companyId },
    });
    return count > 0;
  }

  async acceptInvitation(
    invitationId: string,
    userId: string,
    companyId: string,
    roleId: number,
    acceptedStatusId: number,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const invitation = await tx.invitation.update({
        where: { id: invitationId },
        data: { statusId: acceptedStatusId, respondedAt: new Date() },
        include: this.defaultInclude,
      });

      // Check if a UserCompany already exists (created inactive at invitation time)
      const existingUC = await tx.userCompany.findUnique({
        where: { userId_companyId: { userId, companyId } },
      });

      if (existingUC) {
        await tx.userCompany.update({
          where: { id: existingUC.id },
          data: { isActive: true, joinedAt: new Date() },
        });
      } else {
        await tx.userCompany.create({
          data: {
            userId,
            companyId,
            roleId,
            invitedBy: invitation.invitedBy,
            isActive: true,
            joinedAt: new Date(),
          },
        });
      }

      return invitation;
    });
  }
}
