import { Injectable } from '@nestjs/common';
import { ExperianClient } from '../experian/experian.client.js';
import {
  mapMiDecisorResponse,
  toExperianDocType,
} from '../experian/experian.mapper.js';
import type { ICreditBureauProvider } from './credit-bureau-provider.interface.js';
import type {
  ProviderConsultParams,
  ProviderConsultResult,
} from './provider-result.js';

@Injectable()
export class ExperianProvider implements ICreditBureauProvider {
  readonly name = 'experian';

  constructor(private readonly client: ExperianClient) {}

  resolveDocType(identificationTypeCode: string): string | null {
    return toExperianDocType(identificationTypeCode);
  }

  async consult(params: ProviderConsultParams): Promise<ProviderConsultResult> {
    const { httpStatus, raw } = await this.client.queryMiDecisor({
      tipoIdentificacion: params.docType,
      numeroIdentificacion: params.identificationNumber,
      apellidoRazonSocial: params.apellidoRazonSocial,
    });

    const mapped = mapMiDecisorResponse(raw);

    return {
      meta: mapped.meta,
      customer: mapped.customer,
      risk: mapped.risk,
      httpStatus,
      raw,
    };
  }
}
