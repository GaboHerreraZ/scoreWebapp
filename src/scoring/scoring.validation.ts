import { BadRequestException } from '@nestjs/common';
import {
  SCORING_DIMENSIONS,
  TOTAL_WEIGHT,
  MIN_WEIGHT,
  VERACITY_APPLIES,
  type ScoringDimension,
  type PersonTypeCode,
} from './scoring.constants.js';

/** Pesos por dimensión (columnas de ScoringConfiguration) a validar. */
export type DimensionWeights = Record<ScoringDimension, number>;

/**
 * Valida un conjunto de pesos SEGÚN el tipo de persona. La suma debe ser exacta
 * = 100 y cada peso ACTIVO >= MIN_WEIGHT. La veracidad es especial: en PN NO
 * aplica (debe ser 0, no cuenta para el mínimo); en PJ aplica como el resto.
 * Lanza BadRequestException con un mensaje claro si falla. Única puerta de
 * validación: la usa el CRUD antes de persistir.
 */
export function validateWeights(
  weights: DimensionWeights,
  personType: PersonTypeCode,
): void {
  const veracityApplies = VERACITY_APPLIES[personType];
  let sum = 0;
  for (const dim of SCORING_DIMENSIONS) {
    const value = weights[dim];
    if (!Number.isInteger(value)) {
      throw new BadRequestException(
        `El peso de "${dim}" debe ser un entero (recibido: ${value}).`,
      );
    }
    // Veracidad en PN: debe ser exactamente 0 (no aplica sin contraste).
    if (dim === 'veracity' && !veracityApplies) {
      if (value !== 0) {
        throw new BadRequestException(
          `Para persona natural, el peso de "veracity" debe ser 0 (no hay contraste posible con la central).`,
        );
      }
      sum += value;
      continue;
    }
    if (value < MIN_WEIGHT) {
      throw new BadRequestException(
        `El peso de "${dim}" (${value}) es menor al mínimo permitido (${MIN_WEIGHT}). Ninguna dimensión activa puede quedar apagada.`,
      );
    }
    sum += value;
  }
  if (sum !== TOTAL_WEIGHT) {
    throw new BadRequestException(
      `Los pesos deben sumar ${TOTAL_WEIGHT}; suman ${sum}. Ajústalos para que el total sea exacto.`,
    );
  }
}

/** Columnas weight* de ScoringConfiguration (tipadas explícitamente). */
export interface WeightColumns {
  weightFinancialHealth: number;
  weightPaymentCapacity: number;
  weightTermCoherence: number;
  weightCreditLineAdequacy: number;
  weightCapitalExposure: number;
  weightVeracity: number;
  weightCentralRisk: number;
}

/** Convierte los pesos de dominio a las columnas weight* de Prisma. */
export function weightsToColumns(weights: DimensionWeights): WeightColumns {
  return {
    weightFinancialHealth: weights.financialHealth,
    weightPaymentCapacity: weights.paymentCapacity,
    weightTermCoherence: weights.termCoherence,
    weightCreditLineAdequacy: weights.creditLineAdequacy,
    weightCapitalExposure: weights.capitalExposure,
    weightVeracity: weights.veracity,
    weightCentralRisk: weights.centralRisk,
  };
}
