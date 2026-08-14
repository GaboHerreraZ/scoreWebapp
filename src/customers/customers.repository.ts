import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class CustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

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
        // bureauProfile es un JSONB grande (perfil PJ completo del bureau) que
        // solo consume la vista de DETALLE (findById); en el listado infla
        // cada fila sin uso.
        omit: { bureauProfile: true },
      }),
      this.prisma.customer.count({ where }),
    ]);

    return { data, total };
  }

  async findById(id: string, companyId: string) {
    return this.prisma.customer.findFirst({
      where: { id, companyId },
      include: {
        personType: true,
        company: true,
        economicActivity: true,
        identificationType: true,
        legalRepIdentificationType: true,
        daneCity: {
          select: { name: true, region: { select: { name: true } } },
        },
      },
    });
  }

  async update(id: string, data: Prisma.CustomerUncheckedUpdateInput) {
    return this.prisma.customer.update({
      where: { id },
      data,
      include: {
        personType: true,
        company: true,
        economicActivity: true,
        identificationType: true,
        legalRepIdentificationType: true,
        daneCity: {
          select: { name: true, region: { select: { name: true } } },
        },
      },
    });
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

  async findAllForExport(companyId: string) {
    return this.prisma.customer.findMany({
      where: { companyId },
      orderBy: { businessName: 'asc' },
      include: {
        personType: true,
        identificationType: true,
        economicActivity: true,
        daneCity: {
          select: { name: true, region: { select: { name: true } } },
        },
      },
      // El export solo usa identidad + contacto + labels de los parámetros;
      // sin esto, cada fila arrastra el perfil completo del bureau.
      omit: { bureauProfile: true },
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

    return customers.map((customer) => ({
      id: customer.id,
      name: customer.businessName,
    }));
  }
}
