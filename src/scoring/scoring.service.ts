import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ScoringRepository } from './scoring.repository.js';
import { ParametersRepository } from '../parameters/parameters.repository.js';
import { CreateScoringConfigurationDto } from './dto/create-scoring-configuration.dto.js';
import { CreateScoringDimensionDto } from './dto/create-scoring-dimension.dto.js';
import { UpdateScoringDimensionDto } from './dto/update-scoring-dimension.dto.js';
import {
  dimensionUniverse,
  validateWeightsFor,
  type GenericWeights,
  type StudyTypeCode,
} from './scoring.validation.js';
import {
  defaultWeightsFor,
  SCORING_DIMENSIONS,
  DIMENSION_RULES,
  type ScoringDimension,
  type PersonTypeCode,
} from './scoring.constants.js';
import {
  PAYMENT_CAPACITY_DEFAULT_WEIGHTS,
  PAYMENT_CAPACITY_DIMENSIONS,
  PAYMENT_CAPACITY_DIMENSION_RULES,
  PAYMENT_CAPACITY_PERSON_TYPE,
  type PaymentCapacityDimension,
} from '../payment-capacity/engine/payment-capacity.constants.js';

const VALID_PERSON_TYPES: PersonTypeCode[] = ['naturalPerson', 'legalEntity'];
const VALID_STUDY_TYPES: StudyTypeCode[] = [
  'financialStatements',
  'paymentCapacity',
];

@Injectable()
export class ScoringService {
  constructor(
    private readonly repository: ScoringRepository,
    private readonly parametersRepository: ParametersRepository,
  ) {}

  /**
   * Config vigente de la empresa para (tipo de persona, tipo de estudio). Si no
   * tiene ninguna (p. ej. empresas creadas antes de esta feature), devuelve los
   * pesos DEFAULT del par marcados como no persistidos, para que el front los
   * muestre y ofrezca "guardar" (lo que crea la primera versión real).
   */
  async getActive(
    companyId: string,
    personTypeCode: string,
    studyTypeCode?: string,
  ) {
    const studyType = await this.resolveStudyType(studyTypeCode);
    const personType = await this.resolvePersonType(
      personTypeCode,
      studyType.code as StudyTypeCode,
    );
    const active = await this.repository.findActive(
      companyId,
      personType.id,
      studyType.id,
    );
    if (active) return active;

    // Defaults del sistema: se arma la misma forma que una config persistida
    // (weights con su dimensión del catálogo) para que el front no distinga.
    const defaults = this.defaultsFor(
      studyType.code as StudyTypeCode,
      personTypeCode as PersonTypeCode,
    );
    const catalog = await this.repository.findDimensions();
    const weights = catalog
      .filter((d) => defaults[d.code] !== undefined)
      .map((d) => ({
        id: null,
        configId: null,
        dimensionId: d.id,
        weight: defaults[d.code]!,
        dimension: {
          id: d.id,
          code: d.code,
          label: d.label,
          description: d.description,
          sortOrder: d.sortOrder,
        },
      }));

    return {
      id: null,
      companyId,
      personTypeId: personType.id,
      personType: {
        id: personType.id,
        code: personType.code,
        label: personType.label,
        description: personType.description,
      },
      studyTypeId: studyType.id,
      studyType: {
        id: studyType.id,
        code: studyType.code,
        label: studyType.label,
      },
      weights,
      isActive: true,
      isDefault: true, // aún no persistida: son los defaults del sistema
      createdBy: null,
      createdAt: null,
    };
  }

  /** Historial de configs (opcional: por tipo de persona y/o de estudio). */
  async getHistory(
    companyId: string,
    personTypeCode?: string,
    studyTypeCode?: string,
  ) {
    const studyType = studyTypeCode
      ? await this.resolveStudyType(studyTypeCode)
      : null;
    if (!personTypeCode) {
      return this.repository.findHistory(companyId, undefined, studyType?.id);
    }
    const personType = await this.resolvePersonType(personTypeCode);
    return this.repository.findHistory(companyId, personType.id, studyType?.id);
  }

  /**
   * Crea una nueva versión de configuración para un tipo de persona (la vigente
   * de ese tipo pasa a histórica). El body trae SOLO las dimensiones habilitadas:
   * se valida que los codes existan en el catálogo y estén activos, que las
   * obligatorias estén presentes, que apliquen al tipo, y que los pesos sumen
   * 100 respetando el mínimo.
   */
  async createVersion(
    companyId: string,
    userId: string,
    personTypeCode: string,
    dto: CreateScoringConfigurationDto,
    studyTypeCode?: string,
  ) {
    const studyType = await this.resolveStudyType(studyTypeCode);
    const personType = await this.resolvePersonType(
      personTypeCode,
      studyType.code as StudyTypeCode,
    );
    const universe = dimensionUniverse(studyType.code as StudyTypeCode);

    // Sin dimensiones repetidas en el body.
    const codes = dto.weights.map((w) => w.dimension);
    const duplicated = codes.find((c, i) => codes.indexOf(c) !== i);
    if (duplicated) {
      throw new BadRequestException(
        `La dimensión "${duplicated}" está repetida en la solicitud.`,
      );
    }

    // Resolver codes contra el catálogo: deben existir y estar activos.
    const catalog = await this.repository.findDimensionsByCodes(codes);
    const byCode = new Map(catalog.map((d) => [d.code, d]));
    for (const code of codes) {
      const dim = byCode.get(code);
      if (!dim) {
        throw new BadRequestException(
          `La dimensión "${code}" no existe en el catálogo.`,
        );
      }
      if (!dim.isActive) {
        throw new BadRequestException(
          `La dimensión "${code}" está desactivada del catálogo y no puede habilitarse.`,
        );
      }
      // Fila del catálogo sin soporte en el motor DE ESTE TIPO DE ESTUDIO
      // (cada estudio tiene su set de evaluadores): no se puede habilitar.
      if (!universe.dims.includes(code)) {
        throw new BadRequestException(
          `La dimensión "${code}" no está soportada por el motor de este tipo de estudio.`,
        );
      }
    }

    // Reglas de negocio (obligatorias, aplican al tipo, suma 100, mínimos).
    const weights: GenericWeights = {};
    for (const item of dto.weights) {
      weights[item.dimension] = item.weight;
    }
    validateWeightsFor(
      studyType.code as StudyTypeCode,
      weights,
      personTypeCode as PersonTypeCode,
    );

    return this.repository.createVersion({
      companyId,
      personTypeId: personType.id,
      studyTypeId: studyType.id,
      createdBy: userId,
      weights: dto.weights.map((w) => ({
        dimensionId: byCode.get(w.dimension)!.id,
        weight: w.weight,
      })),
    });
  }

  /**
   * Restaura la configuración de un tipo de persona a los pesos DEFAULT del
   * sistema (defaultWeightsFor). No borra ni muta la vigente: crea una nueva
   * versión con los defaults y la marca vigente (la anterior pasa a histórica),
   * igual que createVersion → queda auditada (createdBy/createdAt) y el historial
   * se preserva. No requiere body: los pesos los pone el sistema.
   */
  async resetToDefaults(
    companyId: string,
    userId: string,
    personTypeCode: string,
    studyTypeCode?: string,
  ) {
    const studyType = await this.resolveStudyType(studyTypeCode);
    const personType = await this.resolvePersonType(
      personTypeCode,
      studyType.code as StudyTypeCode,
    );

    const defaults = this.defaultsFor(
      studyType.code as StudyTypeCode,
      personTypeCode as PersonTypeCode,
    );
    const codes = Object.keys(defaults);

    // Resolver los codes default contra el catálogo: deben existir y estar
    // activos (defensa: si un admin desactivó una dimensión que el default usa,
    // el reset no puede habilitarla).
    const catalog = await this.repository.findDimensionsByCodes(codes);
    const byCode = new Map(catalog.map((d) => [d.code, d]));
    for (const code of codes) {
      const dim = byCode.get(code);
      if (!dim) {
        throw new BadRequestException(
          `La dimensión por defecto "${code}" no existe en el catálogo.`,
        );
      }
      if (!dim.isActive) {
        throw new BadRequestException(
          `La dimensión por defecto "${code}" está desactivada del catálogo; ` +
            `no se puede restaurar el default hasta reactivarla.`,
        );
      }
    }

    // Los defaults del sistema deben ser válidos por construcción, pero se
    // validan igual (única puerta antes de persistir).
    validateWeightsFor(
      studyType.code as StudyTypeCode,
      defaults,
      personTypeCode as PersonTypeCode,
    );

    return this.repository.createVersion({
      companyId,
      personTypeId: personType.id,
      studyTypeId: studyType.id,
      createdBy: userId,
      weights: codes.map((code) => ({
        dimensionId: byCode.get(code)!.id,
        weight: defaults[code]!,
      })),
    });
  }

  /** Una configuración específica por id (validando pertenencia a la empresa). */
  async getById(companyId: string, id: string) {
    const history = await this.repository.findHistory(companyId);
    const found = history.find((c) => c.id === id);
    if (!found) {
      throw new NotFoundException(
        `Configuración de scoring con id=${id} no encontrada en esta empresa`,
      );
    }
    return found;
  }

  // ── Catálogo de dimensiones ────────────────────────────────────────────────

  /**
   * Dimensiones del catálogo enriquecidas con las reglas del motor (required,
   * appliesTo, supported) para que el front sepa qué puede apagar y para quién.
   * Para clientes: solo activas. Para el portal admin: includeInactive=true.
   */
  async listDimensions(includeInactive = false, studyTypeCode?: string) {
    const studyType = await this.resolveStudyType(studyTypeCode);
    const dimensions = await this.repository.findDimensions(includeInactive);
    return dimensions.map((d) =>
      this.withEngineRules(d, studyType.code as StudyTypeCode),
    );
  }

  /**
   * Crea una dimensión en el catálogo (solo portal admin). El code debe estar
   * soportado por el motor: la fila del catálogo es display; sin función eval*
   * detrás no hay nada que evaluar.
   */
  async createDimension(dto: CreateScoringDimensionDto) {
    // Soportada si ALGÚN motor la evalúa (EEFF o capacidad de pago).
    const supportedCodes = new Set<string>([
      ...SCORING_DIMENSIONS,
      ...PAYMENT_CAPACITY_DIMENSIONS,
    ]);
    if (!supportedCodes.has(dto.code)) {
      throw new BadRequestException(
        `El code "${dto.code}" no está soportado por ningún motor de análisis. ` +
          `Soportados: ${[...supportedCodes].join(', ')}. Agregar una dimensión nueva requiere desplegar primero su lógica de evaluación.`,
      );
    }
    const existing = await this.repository.findDimensionByCode(dto.code);
    if (existing) {
      throw new ConflictException(
        `Ya existe una dimensión con el code "${dto.code}".`,
      );
    }
    const created = await this.repository.createDimension(dto);
    return this.withEngineRules(created);
  }

  /**
   * Edición básica de una dimensión (solo portal admin): label, description,
   * sortOrder y activación. Sin borrado físico (eliminación lógica vía
   * isActive); una dimensión OBLIGATORIA del motor no puede desactivarse.
   */
  async updateDimension(id: number, dto: UpdateScoringDimensionDto) {
    const dimension = await this.repository.findDimensionById(id);
    if (!dimension) {
      throw new NotFoundException(`Dimensión con id=${id} no encontrada.`);
    }
    if (dto.isActive === false) {
      // Obligatoria en CUALQUIERA de los dos motores → no se puede desactivar.
      const requiredSomewhere =
        DIMENSION_RULES[dimension.code as ScoringDimension]?.required ||
        PAYMENT_CAPACITY_DIMENSION_RULES[
          dimension.code as PaymentCapacityDimension
        ]?.required;
      if (requiredSomewhere) {
        throw new BadRequestException(
          `La dimensión "${dimension.code}" es parte del núcleo del análisis y no puede desactivarse.`,
        );
      }
    }
    const updated = await this.repository.updateDimension(id, dto);
    return this.withEngineRules(updated);
  }

  /** Anexa las reglas del motor DEL TIPO DE ESTUDIO a una fila del catálogo. */
  private withEngineRules<T extends { code: string }>(
    dimension: T,
    studyType: StudyTypeCode = 'financialStatements',
  ) {
    const { dims, rules } = dimensionUniverse(studyType);
    const supported = dims.includes(dimension.code);
    const dimRules = supported ? rules[dimension.code] : null;
    return {
      ...dimension,
      supported, // false = no evaluable en este tipo de estudio (o sin eval* aún)
      required: dimRules?.required ?? false,
      appliesTo: dimRules?.appliesTo ?? {
        legalEntity: true,
        naturalPerson: true,
      },
    };
  }

  /** Pesos default del par (tipo de estudio, tipo de persona). */
  private defaultsFor(
    studyType: StudyTypeCode,
    personType: PersonTypeCode,
  ): GenericWeights {
    return studyType === 'paymentCapacity'
      ? PAYMENT_CAPACITY_DEFAULT_WEIGHTS
      : defaultWeightsFor(personType);
  }

  /**
   * Resuelve y valida el code del tipo de persona → Parameter. Si el contexto es
   * el estudio de capacidad, solo persona natural es válida.
   */
  private async resolvePersonType(code: string, studyType?: StudyTypeCode) {
    if (!VALID_PERSON_TYPES.includes(code as PersonTypeCode)) {
      throw new BadRequestException(
        `Tipo de persona inválido: "${code}". Use naturalPerson o legalEntity.`,
      );
    }
    if (
      studyType === 'paymentCapacity' &&
      code !== PAYMENT_CAPACITY_PERSON_TYPE
    ) {
      throw new BadRequestException(
        'El estudio de capacidad de pago aplica solo a personas naturales.',
      );
    }
    const param = await this.parametersRepository.findByTypeAndCode(
      'person_type',
      code,
    );
    if (!param) {
      throw new BadRequestException(
        `No se encontró el parámetro person_type "${code}".`,
      );
    }
    return param;
  }

  /** Resuelve y valida el code del tipo de estudio → Parameter (default EEFF). */
  private async resolveStudyType(code?: string) {
    const studyTypeCode = code ?? 'financialStatements';
    if (!VALID_STUDY_TYPES.includes(studyTypeCode as StudyTypeCode)) {
      throw new BadRequestException(
        `Tipo de estudio inválido: "${studyTypeCode}". Use financialStatements o paymentCapacity.`,
      );
    }
    const param = await this.parametersRepository.findByTypeAndCode(
      'study_type',
      studyTypeCode,
    );
    if (!param) {
      throw new BadRequestException(
        `No se encontró el parámetro study_type "${studyTypeCode}".`,
      );
    }
    return param;
  }
}
