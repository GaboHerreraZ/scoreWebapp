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
import { validateWeights } from './scoring.validation.js';
import {
  defaultWeightsFor,
  SCORING_DIMENSIONS,
  DIMENSION_RULES,
  type EnabledWeights,
  type ScoringDimension,
  type PersonTypeCode,
} from './scoring.constants.js';

const VALID_PERSON_TYPES: PersonTypeCode[] = ['naturalPerson', 'legalEntity'];

@Injectable()
export class ScoringService {
  constructor(
    private readonly repository: ScoringRepository,
    private readonly parametersRepository: ParametersRepository,
  ) {}

  /**
   * Config vigente de la empresa para un tipo de persona. Si no tiene ninguna (p.
   * ej. empresas creadas antes de esta feature), devuelve los pesos DEFAULT del
   * tipo marcados como no persistidos, para que el front los muestre y ofrezca
   * "guardar" (lo que crea la primera versión real).
   */
  async getActive(companyId: string, personTypeCode: string) {
    const personType = await this.resolvePersonType(personTypeCode);
    const active = await this.repository.findActive(companyId, personType.id);
    if (active) return active;

    // Defaults del sistema: se arma la misma forma que una config persistida
    // (weights con su dimensión del catálogo) para que el front no distinga.
    const defaults = defaultWeightsFor(personTypeCode as PersonTypeCode);
    const catalog = await this.repository.findDimensions();
    const weights = catalog
      .filter((d) => defaults[d.code as ScoringDimension] !== undefined)
      .map((d) => ({
        id: null,
        configId: null,
        dimensionId: d.id,
        weight: defaults[d.code as ScoringDimension]!,
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
      weights,
      isActive: true,
      isDefault: true, // aún no persistida: son los defaults del sistema
      createdBy: null,
      createdAt: null,
    };
  }

  /** Historial de configuraciones de la empresa (opcional: por tipo de persona). */
  async getHistory(companyId: string, personTypeCode?: string) {
    if (!personTypeCode) return this.repository.findHistory(companyId);
    const personType = await this.resolvePersonType(personTypeCode);
    return this.repository.findHistory(companyId, personType.id);
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
  ) {
    const personType = await this.resolvePersonType(personTypeCode);

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
      // Fila del catálogo sin soporte en el motor (sembrada antes del deploy
      // de su eval*): no se puede habilitar todavía.
      if (!SCORING_DIMENSIONS.includes(code as ScoringDimension)) {
        throw new BadRequestException(
          `La dimensión "${code}" aún no está soportada por el motor de análisis.`,
        );
      }
    }

    // Reglas de negocio (obligatorias, aplican al tipo, suma 100, mínimos).
    const weights: EnabledWeights = {};
    for (const item of dto.weights) {
      weights[item.dimension as ScoringDimension] = item.weight;
    }
    validateWeights(weights, personTypeCode as PersonTypeCode);

    return this.repository.createVersion({
      companyId,
      personTypeId: personType.id,
      createdBy: userId,
      weights: dto.weights.map((w) => ({
        dimensionId: byCode.get(w.dimension)!.id,
        weight: w.weight,
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
  async listDimensions(includeInactive = false) {
    const dimensions = await this.repository.findDimensions(includeInactive);
    return dimensions.map((d) => this.withEngineRules(d));
  }

  /**
   * Crea una dimensión en el catálogo (solo portal admin). El code debe estar
   * soportado por el motor: la fila del catálogo es display; sin función eval*
   * detrás no hay nada que evaluar.
   */
  async createDimension(dto: CreateScoringDimensionDto) {
    if (!SCORING_DIMENSIONS.includes(dto.code as ScoringDimension)) {
      throw new BadRequestException(
        `El code "${dto.code}" no está soportado por el motor de análisis. ` +
          `Soportados: ${SCORING_DIMENSIONS.join(', ')}. Agregar una dimensión nueva requiere desplegar primero su lógica de evaluación.`,
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
      const rules = DIMENSION_RULES[dimension.code as ScoringDimension];
      if (rules?.required) {
        throw new BadRequestException(
          `La dimensión "${dimension.code}" es parte del núcleo del análisis y no puede desactivarse.`,
        );
      }
    }
    const updated = await this.repository.updateDimension(id, dto);
    return this.withEngineRules(updated);
  }

  /** Anexa las reglas del motor a una fila del catálogo (para el front). */
  private withEngineRules<T extends { code: string }>(dimension: T) {
    const supported = SCORING_DIMENSIONS.includes(
      dimension.code as ScoringDimension,
    );
    const rules = supported
      ? DIMENSION_RULES[dimension.code as ScoringDimension]
      : null;
    return {
      ...dimension,
      supported, // false = sembrada antes del deploy de su eval* (no habilitable aún)
      required: rules?.required ?? false,
      appliesTo: rules?.appliesTo ?? { legalEntity: true, naturalPerson: true },
    };
  }

  /** Resuelve y valida el code del tipo de persona → Parameter. */
  private async resolvePersonType(code: string) {
    if (!VALID_PERSON_TYPES.includes(code as PersonTypeCode)) {
      throw new BadRequestException(
        `Tipo de persona inválido: "${code}". Use naturalPerson o legalEntity.`,
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
}
