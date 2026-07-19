import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

// La tabla parameters es un catálogo casi estático (roles, estados, sectores...)
// que se consulta en casi todos los flujos (resolver ids de estado, listados del
// front). Cache-aside en memoria: TTL como red de seguridad para cambios hechos
// por fuera de la app (seeds SQL u otra instancia) y limpieza total ante
// cualquier escritura local. Los chequeos de borrado (hasChildren,
// isReferencedByOtherTables) NO se cachean: deben ser siempre frescos.
const CACHE_TTL_MS = 5 * 60_000;
// Tope de entradas: las llaves de findAll dependen de filtros de usuario
// (search), así que el espacio de llaves no está acotado por sí solo.
const CACHE_MAX_ENTRIES = 500;

@Injectable()
export class ParametersRepository {
  constructor(private readonly prisma: PrismaService) {}

  private readonly cache = new Map<
    string,
    { value: unknown; expiresAt: number }
  >();

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.value as T;
    }
    const value = await load();
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      this.cache.clear();
    }
    this.cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  }

  private invalidateCache() {
    this.cache.clear();
  }

  async create(data: Prisma.ParameterCreateInput) {
    const created = await this.prisma.parameter.create({ data });
    this.invalidateCache();
    return created;
  }

  async findAll(params: {
    where?: Prisma.ParameterWhereInput;
    orderBy?: Prisma.ParameterOrderByWithRelationInput;
  }) {
    const { where, orderBy } = params;

    return this.cached(
      `findAll:${JSON.stringify(where ?? {})}:${JSON.stringify(orderBy ?? {})}`,
      async () => {
        const [data, total] = await Promise.all([
          this.prisma.parameter.findMany({
            where,
            orderBy,
            include: { parent: true },
          }),
          this.prisma.parameter.count({ where }),
        ]);

        return { data, total };
      },
    );
  }

  async findById(id: number) {
    return this.cached(`findById:${id}`, () =>
      this.prisma.parameter.findUnique({
        where: { id },
        include: { parent: true, children: true },
      }),
    );
  }

  async findByCode(code: string) {
    return this.cached(`findByCode:${code}`, () =>
      this.prisma.parameter.findFirst({
        where: {
          code,
        },
      }),
    );
  }

  async findByTypeAndCode(type: string, code: string) {
    return this.cached(`findByTypeAndCode:${type}:${code}`, () =>
      this.prisma.parameter.findUnique({
        where: { type_code: { type, code } },
      }),
    );
  }

  async update(id: number, data: Prisma.ParameterUpdateInput) {
    const updated = await this.prisma.parameter.update({
      where: { id },
      data,
      include: { parent: true },
    });
    this.invalidateCache();
    return updated;
  }

  async delete(id: number) {
    const deleted = await this.prisma.parameter.delete({ where: { id } });
    this.invalidateCache();
    return deleted;
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
