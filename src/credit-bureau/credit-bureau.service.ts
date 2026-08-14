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
import { CustomerAuthorizationsService } from '../customer-authorizations/customer-authorizations.service.js';

@Injectable()
export class CreditBureauService {
  constructor(
    @Inject(CREDIT_BUREAU_PROVIDER)
    private readonly provider: ICreditBureauProvider,
    private readonly repository: CreditBureauRepository,
    private readonly parametersRepository: ParametersRepository,
    private readonly authorizationsService: CustomerAuthorizationsService,
  ) {}

  async consult(
    companyId: string,
    userId: string,
    dto: ConsultCreditBureauDto,
    // titularEmail del from-bureau: respaldo de Customer.email y, en PJ,
    // correo del representante legal (firmante de la autorización).
    fallbackEmail?: string,
  ) {
    // GATE: el titular debe haber firmado la autorización (documento único) para
    // esta empresa. Sin firma vigente → 403 CUSTOMER_AUTHORIZATION_REQUIRED, sin
    // consultar ni crear/actualizar Customer. Cubre también la caché: no mostramos
    // data (nueva ni previa) sin consentimiento vigente.
    await this.authorizationsService.ensureCanConsult(
      companyId,
      dto.numeroIdentificacion,
    );

    // 0. Caché: si el cliente ya existe y su última consulta sigue vigente
    //    (dentro de la ventana: hasta el día 10 del mes siguiente), se retorna
    //    de BBDD sin gastar una consulta a la central. La central actualiza su
    //    info en los primeros 10 días de cada mes, así que antes de esa fecha
    //    re-consultar traería la misma data.
    const cached = await this.tryReuseCachedConsultation(
      companyId,
      dto.numeroIdentificacion,
    );
    if (cached) {
      await this.authorizationsService.linkConsultedCustomer(
        companyId,
        dto.numeroIdentificacion,
        cached.customer.id,
      );
      // La caché se salta el persist: si el Customer quedó sin email (creado
      // antes de este backfill), se completa aquí con el de la petición.
      if (!cached.customer.email && fallbackEmail) {
        const written = await this.repository.setCustomerEmailIfMissing(
          cached.customer.id,
          fallbackEmail,
        );
        if (written) cached.customer.email = fallbackEmail;
      }
      // Ídem correo del representante legal (solo PJ).
      if (!cached.customer.legalRepEmail && fallbackEmail) {
        const legalEntity = await this.parametersRepository.findByTypeAndCode(
          'person_type',
          'legalEntity',
        );
        if (legalEntity && cached.customer.personTypeId === legalEntity.id) {
          const written =
            await this.repository.setCustomerLegalRepEmailIfMissing(
              cached.customer.id,
              fallbackEmail,
            );
          if (written) cached.customer.legalRepEmail = fallbackEmail;
        }
      }
      return cached;
    }

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

    // 5. Persistir (snapshot + upsert customer + risk) en transacción.
    //    Email: el del bureau (solo PJ) o el de la petición. Contacto y rep
    //    legal solo siembran el create; después son editables.
    const bureauContact = result.customer.bureauProfile?.contact ?? null;
    const bureauEmail = bureauContact?.email ?? null;
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
        contactEmail: bureauEmail ?? fallbackEmail ?? null,
        contactSeed: {
          phone: bureauContact?.phone ?? null,
          city: bureauContact?.city ?? null,
          address: bureauContact?.address ?? null,
          economicActivityId: await this.resolveEconomicActivityId(
            result.customer.bureauProfile?.generalProfile?.ciiuCode ?? null,
          ),
        },
        legalRepSeed: result.customer.legalRepSeed
          ? {
              name: result.customer.legalRepSeed.name,
              identificationTypeId: result.customer.legalRepSeed
                .identificationTypeCode
                ? await this.resolveIdentificationTypeId(
                    result.customer.legalRepSeed.identificationTypeCode,
                  )
                : null,
              identificationNumber:
                result.customer.legalRepSeed.identificationNumber,
            }
          : null,
        // PJ: titularEmail = correo del representante legal (firmante de la autorización).
        legalRepEmailFallback:
          result.meta.personType === 'PJ' ? (fallbackEmail ?? null) : null,
      });

    // Backfill: enlaza la autorización firmada con el Customer recién creado.
    await this.authorizationsService.linkConsultedCustomer(
      companyId,
      dto.numeroIdentificacion,
      customer.id,
    );

    // Mismo shape que la ruta de caché: city/state resueltos. Un Customer recién
    // creado por la central solo tiene bureauCity (sin departamento).
    const { bureauCity, ...customerData } = customer;
    return {
      fromCache: false,
      consultationId: consultation.id,
      customer: { ...customerData, city: bureauCity ?? null, state: null },
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
    const {
      bureauConsultations: _omit,
      daneCity,
      bureauCity,
      ...customerData
    } = customer;
    void _omit;
    return {
      fromCache: true,
      consultationId: last.id,
      // city/state resueltos, igual que en el resto de la API: el municipio
      // elegido manda y, si no hay, el texto que reportó la central.
      customer: {
        ...customerData,
        city: daneCity?.name ?? bureauCity ?? null,
        state: daneCity?.region.name ?? null,
      },
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

  /**
   * CIIU de la central (PJ) → Parameter 'sector'. Reintenta con ceros a la
   * izquierda; null si no está en el catálogo (nunca bloquea la consulta).
   */
  private async resolveEconomicActivityId(
    ciiuCode: string | null,
  ): Promise<number | null> {
    const code = ciiuCode?.trim();
    if (!code) return null;

    const param =
      (await this.parametersRepository.findByTypeAndCode('sector', code)) ??
      (code.length < 4
        ? await this.parametersRepository.findByTypeAndCode(
            'sector',
            code.padStart(4, '0'),
          )
        : null);
    return param?.id ?? null;
  }
}
