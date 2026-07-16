import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

// El tipo de persona se devuelve con su descripción legible (no solo el id), para
// que el front muestre "Persona Natural"/"Persona Jurídica" sin resolver el id.
const PERSON_TYPE_SELECT = {
  select: { id: true, code: true, label: true, description: true },
} as const;

// Pesos con su dimensión resuelta (code/label/description para el front), en el
// orden de display del catálogo.
const WEIGHTS_INCLUDE = {
  include: {
    dimension: {
      select: {
        id: true,
        code: true,
        label: true,
        description: true,
        sortOrder: true,
      },
    },
  },
  orderBy: { dimension: { sortOrder: 'asc' } },
} as const;

const CONFIG_INCLUDE = {
  personType: PERSON_TYPE_SELECT,
  weights: WEIGHTS_INCLUDE,
} as const;

@Injectable()
export class ScoringRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Config vigente (isActive) de una empresa para un tipo de persona. */
  async findActive(companyId: string, personTypeId: number) {
    return this.prisma.scoringConfiguration.findFirst({
      where: { companyId, personTypeId, isActive: true },
      orderBy: { createdAt: 'desc' },
      include: CONFIG_INCLUDE,
    });
  }

  /**
   * Historial de configuraciones de una empresa (más reciente primero).
   * Opcionalmente acotado a un tipo de persona.
   */
  async findHistory(companyId: string, personTypeId?: number) {
    return this.prisma.scoringConfiguration.findMany({
      where: { companyId, ...(personTypeId ? { personTypeId } : {}) },
      orderBy: { createdAt: 'desc' },
      include: CONFIG_INCLUDE,
    });
  }

  /**
   * Crea una configuración nueva para un tipo de persona con sus filas de pesos
   * (solo dimensiones habilitadas) y la marca vigente, desactivando la anterior
   * DEL MISMO TIPO en una transacción (versionado por (empresa, tipo)). No borra
   * nada → el historial se preserva; los estudios viejos siguen atados a su config.
   */
  async createVersion(params: {
    companyId: string;
    personTypeId: number;
    createdBy: string;
    weights: Array<{ dimensionId: number; weight: number }>;
  }) {
    const { companyId, personTypeId, createdBy, weights } = params;
    return this.prisma.$transaction(async (tx) => {
      await tx.scoringConfiguration.updateMany({
        where: { companyId, personTypeId, isActive: true },
        data: { isActive: false },
      });
      return tx.scoringConfiguration.create({
        data: {
          companyId,
          personTypeId,
          createdBy,
          isActive: true,
          weights: { create: weights },
        },
        include: CONFIG_INCLUDE,
      });
    });
  }

  // ── Catálogo de dimensiones (scoring_dimensions) ──────────────────────────

  /** Dimensiones del catálogo (por defecto solo activas), en orden de display. */
  async findDimensions(includeInactive = false) {
    return this.prisma.scoringDimension.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findDimensionById(id: number) {
    return this.prisma.scoringDimension.findUnique({ where: { id } });
  }

  async findDimensionByCode(code: string) {
    return this.prisma.scoringDimension.findUnique({ where: { code } });
  }

  /** Dimensiones por code (para resolver los pesos de una config nueva). */
  async findDimensionsByCodes(codes: string[]) {
    return this.prisma.scoringDimension.findMany({
      where: { code: { in: codes } },
    });
  }

  async createDimension(data: {
    code: string;
    label: string;
    description?: string;
    sortOrder?: number;
  }) {
    return this.prisma.scoringDimension.create({ data });
  }

  /** Edición básica del catálogo: label/description/orden/activación. El code no
   *  se toca (es la llave que ata la fila a la lógica del motor) y no hay
   *  borrado físico: desactivar = isActive false. */
  async updateDimension(
    id: number,
    data: {
      label?: string;
      description?: string;
      sortOrder?: number;
      isActive?: boolean;
    },
  ) {
    return this.prisma.scoringDimension.update({ where: { id }, data });
  }
}
