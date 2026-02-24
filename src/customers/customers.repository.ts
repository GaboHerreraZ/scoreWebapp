import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class CustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.CustomerUncheckedCreateInput) {
    return this.prisma.customer.create({
      data,
      include: { personType: true, company: true },
    });
  }

  async findAll(params: {
    skip: number;
    take: number;
    where?: Prisma.CustomerWhereInput;
    orderBy?: Prisma.CustomerOrderByWithRelationInput;
  }) {
    const { skip, take, where, orderBy } = params;

    const [data, total] = await Promise.all([
      this.prisma.customer.findMany({
        skip,
        take,
        where,
        orderBy,
        include: { personType: true },
      }),
      this.prisma.customer.count({ where }),
    ]);

    return { data, total };
  }

  async findById(id: string, companyId: string) {
    return this.prisma.customer.findFirst({
      where: { id, companyId },
      include: { personType: true, company: true, economicActivity: true },
    });
  }

  async findByIdentification(identificationNumber: string, companyId: string) {
    return this.prisma.customer.findFirst({
      where: { identificationNumber, companyId },
    });
  }

  async update(id: string, data: Prisma.CustomerUncheckedUpdateInput) {
    return this.prisma.customer.update({
      where: { id },
      data,
      include: { personType: true, company: true },
    });
  }

  async delete(id: string) {
    return this.prisma.customer.delete({ where: { id } });
  }

  async hasCreditStudies(id: string): Promise<boolean> {
    const count = await this.prisma.creditStudy.count({
      where: { customerId: id },
    });
    return count > 0;
  }

  async findCreditStudiesByCustomerId(params: {
    customerId: string;
    companyId: string;
    orderBy?: Prisma.CreditStudyOrderByWithRelationInput;
  }) {
    const { customerId, companyId, orderBy } = params;

    return this.prisma.creditStudy.findMany({
      where: { customerId, companyId },
      orderBy,
      include: { status: true },
    });
  }

  async autocomplete(companyId: string, search?: string) {
    const where: Prisma.CustomerWhereInput = { companyId };

    if (search) {
      where.businessName = { contains: search, mode: 'insensitive' };
    }

    const customers = await this.prisma.customer.findMany({
      where,
      select: {
        id: true,
        businessName: true,
      },
      orderBy: { businessName: 'asc' },
      take: 50,
    });

    return customers.map(customer => ({
      id: customer.id,
      name: customer.businessName,
    }));
  }
}
