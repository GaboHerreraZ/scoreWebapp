import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ScoringRepository } from './scoring.repository.js';
import { ParametersRepository } from '../parameters/parameters.repository.js';
import { CreateScoringConfigurationDto } from './dto/create-scoring-configuration.dto.js';
import { validateWeights, weightsToColumns } from './scoring.validation.js';
import { defaultWeightsFor, type PersonTypeCode } from './scoring.constants.js';

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
      ...weightsToColumns(defaultWeightsFor(personTypeCode as PersonTypeCode)),
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
   * de ese tipo pasa a histórica). Valida que los pesos sumen 100 y respeten el
   * mínimo por dimensión según el tipo (en PN la veracidad debe ser 0).
   */
  async createVersion(
    companyId: string,
    userId: string,
    personTypeCode: string,
    dto: CreateScoringConfigurationDto,
  ) {
    const personType = await this.resolvePersonType(personTypeCode);
    const weights = {
      financialHealth: dto.weightFinancialHealth,
      paymentCapacity: dto.weightPaymentCapacity,
      termCoherence: dto.weightTermCoherence,
      creditLineAdequacy: dto.weightCreditLineAdequacy,
      capitalExposure: dto.weightCapitalExposure,
      veracity: dto.weightVeracity,
      centralRisk: dto.weightCentralRisk,
    };
    // Lanza BadRequestException si no cumple las reglas del tipo.
    validateWeights(weights, personTypeCode as PersonTypeCode);

    return this.repository.createVersion({
      companyId,
      personTypeId: personType.id,
      createdBy: userId,
      weights: weightsToColumns(weights),
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
