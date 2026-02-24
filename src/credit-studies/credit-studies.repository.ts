import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class CreditStudiesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.CreditStudyUncheckedCreateInput) {
    return this.prisma.creditStudy.create({
      data,
      include: { customer: true, status: true },
    });
  }

  async findAll(params: {
    skip: number;
    take: number;
    where?: Prisma.CreditStudyWhereInput;
    orderBy?: Prisma.CreditStudyOrderByWithRelationInput;
  }) {
    const { skip, take, where, orderBy } = params;

    const [data, total] = await Promise.all([
      this.prisma.creditStudy.findMany({
        skip,
        take,
        where,
        orderBy,
        select: {
          id: true,
          resolutionDate: true,
          createdBy: true,
          requestedTerm: true,
          studyDate: true,
          requestedMonthlyCreditLine: true,
          customer: {
            select: {
              id: true,
              businessName: true,
            },
          },
          status: {
            select: {
              id: true,
              label: true,
            },
          },
        },
      }),
      this.prisma.creditStudy.count({ where }),
    ]);

    return { data, total };
  }

  async findById(id: string, companyId: string) {
    return this.prisma.creditStudy.findFirst({
      where: { id, companyId },
      include: {
        customer: {
          select: {
            id: true,
            businessName: true,
          },
        },
        company: {
          select: {
            id: true,
            name: true,
          },
        },
        status: {
          select: {
            id: true,
            label: true,
          },
        },
      },
    });
  }

  async update(id: string, data: Prisma.CreditStudyUncheckedUpdateInput) {
    return this.prisma.creditStudy.update({
      where: { id },
      data,
      include: { customer: true, status: true },
    });
  }

  async delete(id: string) {
    return this.prisma.creditStudy.delete({ where: { id } });
  }

  async customerBelongsToCompany(
    customerId: string,
    companyId: string,
  ): Promise<boolean> {
    const count = await this.prisma.customer.count({
      where: { id: customerId, companyId },
    });
    return count > 0;
  }
}
