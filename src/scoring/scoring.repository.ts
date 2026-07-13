import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { WeightColumns } from './scoring.validation.js';

// El tipo de persona se devuelve con su descripción legible (no solo el id), para
// que el front muestre "Persona Natural"/"Persona Jurídica" sin resolver el id.
const PERSON_TYPE_SELECT = {
  select: { id: true, code: true, label: true, description: true },
} as const;

@Injectable()
export class ScoringRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Config vigente (isActive) de una empresa para un tipo de persona. */
  async findActive(companyId: string, personTypeId: number) {
    return this.prisma.scoringConfiguration.findFirst({
      where: { companyId, personTypeId, isActive: true },
      orderBy: { createdAt: 'desc' },
      include: { personType: PERSON_TYPE_SELECT },
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
      include: { personType: PERSON_TYPE_SELECT },
    });
  }

  /**
   * Crea una configuración nueva para un tipo de persona y la marca vigente,
   * desactivando la anterior DEL MISMO TIPO en una transacción (versionado por
   * (empresa, tipo)). No borra nada → el historial se preserva; los estudios
   * viejos siguen atados a su config.
   */
  async createVersion(params: {
    companyId: string;
    personTypeId: number;
    createdBy: string;
    weights: WeightColumns;
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
          ...weights,
        },
        include: { personType: PERSON_TYPE_SELECT },
      });
    });
  }
}
