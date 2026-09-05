import { BadRequestException } from '@nestjs/common';
import {
  SCORING_DIMENSIONS,
  TOTAL_WEIGHT,
  MIN_WEIGHT,
  DIMENSION_RULES,
  type DimensionRules,
  type EnabledWeights,
  type ScoringDimension,
  type PersonTypeCode,
} from './scoring.constants.js';
import {
  PAYMENT_CAPACITY_DIMENSIONS,
  PAYMENT_CAPACITY_DIMENSION_RULES,
} from '../payment-capacity/engine/payment-capacity.constants.js';

/** Tipos de estudio con set de dimensiones propio. */
export type StudyTypeCode = 'financialStatements' | 'paymentCapacity';

/** Pesos genéricos (dimensión → peso) sin atarse a un tipo de estudio. */
export type GenericWeights = Partial<Record<string, number>>;

/** Universo de dimensiones (lista canónica + reglas) según el tipo de estudio. */
export function dimensionUniverse(studyType: StudyTypeCode): {
  dims: readonly string[];
  rules: Record<string, DimensionRules>;
} {
  return studyType === 'paymentCapacity'
    ? {
        dims: PAYMENT_CAPACITY_DIMENSIONS,
        rules: PAYMENT_CAPACITY_DIMENSION_RULES,
      }
    : { dims: SCORING_DIMENSIONS, rules: DIMENSION_RULES };
}

/**
 * Valida el set de dimensiones HABILITADAS y sus pesos SEGÚN el tipo de
 * estudio y el tipo de persona. Reglas:
 *  - Toda dimensión obligatoria (rules.required) debe estar presente.
 *  - Ninguna dimensión habilitada puede no aplicar al tipo (p. ej. veracity en PN).
 *  - Cada peso es entero y >= MIN_WEIGHT (habilitar con peso simbólico = apagar de facto).
 *  - La suma exacta es TOTAL_WEIGHT (100).
 * Lanza BadRequestException con un mensaje claro si falla. Única puerta de
 * validación: la usa el CRUD antes de persistir. (Que el code exista en el
 * catálogo BD y esté activo lo valida el servicio, que sí lee BD.)
 */
export function validateWeightsFor(
  studyType: StudyTypeCode,
  weights: GenericWeights,
  personType: PersonTypeCode,
): void {
  const { dims, rules } = dimensionUniverse(studyType);
  const enabled = dims.filter((dim) => weights[dim] !== undefined);
  if (enabled.length === 0) {
    throw new BadRequestException(
      'Debe habilitar al menos las dimensiones obligatorias del análisis.',
    );
  }

  // Obligatorias presentes (solo las que aplican al tipo de persona).
  for (const dim of dims) {
    const dimRules = rules[dim];
    if (
      dimRules.required &&
      dimRules.appliesTo[personType] &&
      weights[dim] === undefined
    ) {
      throw new BadRequestException(
        `La dimensión "${dim}" es obligatoria y no puede deshabilitarse.`,
      );
    }
  }

  let sum = 0;
  for (const dim of enabled) {
    const value = weights[dim]!;
    if (!rules[dim].appliesTo[personType]) {
      throw new BadRequestException(
        `La dimensión "${dim}" no aplica para ${personType === 'naturalPerson' ? 'persona natural' : 'persona jurídica'} y no puede habilitarse.`,
      );
    }
    if (!Number.isInteger(value)) {
      throw new BadRequestException(
        `El peso de "${dim}" debe ser un entero (recibido: ${value}).`,
      );
    }
    if (value < MIN_WEIGHT) {
      throw new BadRequestException(
        `El peso de "${dim}" (${value}) es menor al mínimo permitido (${MIN_WEIGHT}). Para no usar una dimensión, deshabilítela en vez de bajarle el peso.`,
      );
    }
    sum += value;
  }
  if (sum !== TOTAL_WEIGHT) {
    throw new BadRequestException(
      `Los pesos de las dimensiones habilitadas deben sumar ${TOTAL_WEIGHT}; suman ${sum}. Ajústelos para que el total sea exacto.`,
    );
  }
}

/** Compat: validación del flujo EEFF (callers previos al eje de tipo de estudio). */
export function validateWeights(
  weights: EnabledWeights,
  personType: PersonTypeCode,
): void {
  validateWeightsFor('financialStatements', weights, personType);
}

/** Dimensiones habilitadas de un set de pesos, en el orden canónico del motor. */
export function enabledDimensions(weights: EnabledWeights): ScoringDimension[] {
  return SCORING_DIMENSIONS.filter((dim) => weights[dim] !== undefined);
}
