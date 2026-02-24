import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class ParametersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.ParameterCreateInput) {
    return this.prisma.parameter.create({ data });
  }

  async findAll(params: {
    where?: Prisma.ParameterWhereInput;
    orderBy?: Prisma.ParameterOrderByWithRelationInput;
  }) {
    const { where, orderBy } = params;

    const [data, total] = await Promise.all([
      this.prisma.parameter.findMany({
        where,
        orderBy,
        include: { parent: true },
      }),
      this.prisma.parameter.count({ where }),
    ]);

    return { data, total };
  }

  async findById(id: number) {
    return this.prisma.parameter.findUnique({
      where: { id },
      include: { parent: true, children: true },
    });
  }

  async findByCode(code: string) {
    return this.prisma.parameter.findFirst({
      where: {
        code,
      },
    });
  }

  async findByTypeAndCode(type: string, code: string) {
    return this.prisma.parameter.findUnique({
      where: { type_code: { type, code } },
    });
  }

  async update(id: number, data: Prisma.ParameterUpdateInput) {
    return this.prisma.parameter.update({
      where: { id },
      data,
      include: { parent: true },
    });
  }

  async delete(id: number) {
    return this.prisma.parameter.delete({ where: { id } });
  }

  async hasChildren(id: number): Promise<boolean> {
    const count = await this.prisma.parameter.count({
      where: { parentId: id },
    });
    return count > 0;
  }

  async isReferencedByOtherTables(id: number): Promise<boolean> {
    const [companies, customers, creditStudies] = await Promise.all([
      this.prisma.company.count({ where: { sectorId: id } }),
      this.prisma.customer.count({ where: { personTypeId: id } }),
      this.prisma.creditStudy.count({ where: { statusId: id } }),
    ]);

    return companies + customers + creditStudies > 0;
  }
}
