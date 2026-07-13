import type {
  ProviderConsultParams,
  ProviderConsultResult,
} from './provider-result.js';

export const CREDIT_BUREAU_PROVIDER = Symbol('CREDIT_BUREAU_PROVIDER');

export interface ICreditBureauProvider {
  readonly name: string;

  consult(params: ProviderConsultParams): Promise<ProviderConsultResult>;

  resolveDocType(identificationTypeCode: string): string | null;
}
