import {
  Inject,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { CreditBureauRepository } from './credit-bureau.repository.js';
import { ParametersRepository } from '../parameters/parameters.repository.js';
import {
  CREDIT_BUREAU_PROVIDER,
  type ICreditBureauProvider,
} from './providers/credit-bureau-provider.interface.js';
import { ConsultCreditBureauDto } from './dto/consult-credit-bureau.dto.js';
import { isConsultationFresh } from './utils/consultation-freshness.js';

@Injectable()
export class CreditBureauService {
  constructor(
    @Inject(CREDIT_BUREAU_PROVIDER)
    private readonly provider: ICreditBureauProvider,
    private readonly repository: CreditBureauRepository,
    private readonly parametersRepository: ParametersRepository,
  ) {}

  async consult(
    companyId: string,
    userId: string,
    dto: ConsultCreditBureauDto,
  ) {
    // 0. Caché: si el cliente ya existe y su última consulta sigue vigente
    //    (dentro de la ventana: hasta el día 10 del mes siguiente), se retorna
    //    de BBDD sin gastar una consulta a la central. La central actualiza su
    //    info en los primeros 10 días de cada mes, así que antes de esa fecha
    //    re-consultar traería la misma data.
    const cached = await this.tryReuseCachedConsultation(
      companyId,
      dto.numeroIdentificacion,
    );
    if (cached) return cached;

    // 1. Traducir el tipo de identificación al formato del proveedor
    const docType = this.provider.resolveDocType(dto.identificationTypeCode);
    if (!docType) {
      throw new InternalServerErrorException(
        `Tipo de identificación "${dto.identificationTypeCode}" sin mapeo para el proveedor ${this.provider.name}.`,
      );
    }

    // 2. Consultar la central (el provider hace HTTP + traducción a dominio)
    const result = await this.provider.consult({
      docType,
      identificationNumber: dto.numeroIdentificacion,
      apellidoRazonSocial: dto.apellidoRazonSocial,
    });

    // 3. Sin información → no se persiste nada; el cliente no existe en la central
    if (!result.meta.conInformacion || !result.customer) {
      throw new NotFoundException(
        'La central de riesgo no tiene información para la identificación consultada.',
      );
    }

    // 4. Resolver los ids de Parameter para persistir el Customer
    const personTypeCode =
      result.meta.personType === 'PJ' ? 'legalEntity' : 'naturalPerson';
    const personType = await this.parametersRepository.findByTypeAndCode(
      'person_type',
      personTypeCode,
    );
    if (!personType) {
      throw new InternalServerErrorException(
        `Parameter person_type "${personTypeCode}" no encontrado.`,
      );
    }

    const identificationTypeId = await this.resolveIdentificationTypeId(
      result.customer.identificationTypeCode ?? dto.identificationTypeCode,
    );

    // 5. Persistir (snapshot + upsert customer + risk) en transacción
    const { consultation, customer } =
      await this.repository.persistConsultation({
        companyId,
        userId,
        provider: this.provider.name,
        personTypeId: personType.id,
        identificationTypeId,
        meta: result.meta,
        customer: result.customer,
        risk: result.risk,
        rawResponse: result.raw,
        httpStatus: result.httpStatus,
      });

    return {
      fromCache: false,
      consultationId: consultation.id,
      customer,
    };
  }

  /**
   * Si el cliente ya existe (companyId + identificación) y su última consulta
   * sigue vigente, devuelve esa consulta desde BBDD (sin llamar a la central ni
   * escribir). Devuelve null si no hay cliente, no hay consultas, o la última ya
   * venció → el llamador procede a consultar la central.
   */
  private async tryReuseCachedConsultation(
    companyId: string,
    identificationNumber: string,
  ) {
    const customer = await this.repository.findCustomerWithLastConsultation(
      companyId,
      identificationNumber,
    );
    const last = customer?.bureauConsultations[0];
    if (!customer || !last) return null;

    if (!isConsultationFresh(last.consultaAt, new Date())) return null;

    // Devolvemos solo los campos del Customer (sin la relación cargada), para
    // que el shape coincida con el de una consulta fresca.
    const { bureauConsultations: _omit, ...customerData } = customer;
    void _omit;
    return {
      fromCache: true,
      consultationId: last.id,
      customer: customerData,
    };
  }

  private async resolveIdentificationTypeId(
    code: string,
  ): Promise<number | null> {
    const param = await this.parametersRepository.findByTypeAndCode(
      'identification_type',
      code.toLowerCase(),
    );
    return param?.id ?? null;
  }
}
