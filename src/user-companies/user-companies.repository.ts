import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class UserCompaniesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.UserCompanyUncheckedCreateInput) {
    return this.prisma.userCompany.create({
      data,
      include: { user: true, company: true, role: true, invitedByUser: true },
    });
  }

  async findAll(params: {
    skip: number;
    take: number;
    where?: Prisma.UserCompanyWhereInput;
    orderBy?: Prisma.UserCompanyOrderByWithRelationInput;
  }) {
    const { skip, take, where, orderBy } = params;

    const [data, total] = await Promise.all([
      this.prisma.userCompany.findMany({
        skip,
        take,
        where,
        orderBy,
        include: { user: true, company: true, role: true, invitedByUser: true },
      }),
      this.prisma.userCompany.count({ where }),
    ]);

    return { data, total };
  }

  async findById(id: string, companyId: string) {
    return this.prisma.userCompany.findFirst({
      where: { id, companyId },
      include: { user: true, company: true, role: true, invitedByUser: true },
    });
  }

  async findByUserAndCompany(userId: string, companyId: string) {
    return this.prisma.userCompany.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
  }

  async update(id: string, data: Prisma.UserCompanyUncheckedUpdateInput) {
    return this.prisma.userCompany.update({
      where: { id },
      data,
      include: { user: true, company: true, role: true, invitedByUser: true },
    });
  }

  async delete(id: string) {
    return this.prisma.userCompany.delete({ where: { id } });
  }

  async profileExists(userId: string): Promise<boolean> {
    const count = await this.prisma.profile.count({ where: { id: userId } });
    return count > 0;
  }

  async companyExists(companyId: string): Promise<boolean> {
    const count = await this.prisma.company.count({ where: { id: companyId } });
    return count > 0;
  }

  async parameterExists(parameterId: number): Promise<boolean> {
    const count = await this.prisma.parameter.count({ where: { id: parameterId } });
    return count > 0;
  }
}
