import { BadRequestException, Injectable } from '@nestjs/common';
import { ParametersRepository } from '../parameters/parameters.repository.js';
import { isLegalEntityDocument } from './domain/dian.catalogs.js';

/** Datos de facturación de una empresa, en lo que a la DIAN le importa. */
export interface BillingProfile {
  billingDocTypeId: number | null;
  billingDocNumber: string | null;
  billingEmail: string | null;
  billingAddress: string | null;
  billingCityCode: string | null;
  billingRegimeTypeId: number | null;
  billingFiscalResponsibilities: string[];
  billingBusinessName: string | null;
  billingName: string | null;
  billingLastName: string | null;
}

/**
 * Valida el perfil fiscal del adquirente.
 *
 * Dos responsabilidades distintas:
 *  - `validateSelection`: lo que se envía es válido (los parámetros existen y
 *    son del tipo correcto). Se usa al guardar.
 *  - `assertReadyToInvoice`: el perfil está COMPLETO. Se usa antes de cobrar,
 *    no antes de facturar: si se deja para el momento de emitir, se acumulan
 *    ventas ya cobradas que no se pueden facturar.
 */
@Injectable()
export class FiscalProfileValidator {
  constructor(private readonly parametersRepository: ParametersRepository) {}

  /** El régimen enviado existe y es un Parameter 'tax_regime' activo. */
  async validateRegimeType(id: number | null | undefined): Promise<void> {
    if (id == null) return;
    const param = await this.parametersRepository.findById(id);
    if (!param || param.type !== 'tax_regime' || !param.isActive) {
      throw new BadRequestException(
        `billingRegimeTypeId=${id} no es un régimen válido (Parameter tipo 'tax_regime' activo)`,
      );
    }
  }

  /** Cada código existe en 'fiscal_responsibility' y no hay repetidos. */
  async validateResponsibilities(
    codes: string[] | null | undefined,
  ): Promise<void> {
    if (!codes) return;

    const unique = new Set(codes);
    if (unique.size !== codes.length) {
      throw new BadRequestException(
        'billingFiscalResponsibilities tiene códigos repetidos',
      );
    }

    for (const code of unique) {
      const param = await this.parametersRepository.findByTypeAndCode(
        'fiscal_responsibility',
        code,
      );
      if (!param || !param.isActive) {
        throw new BadRequestException(
          `'${code}' no es una responsabilidad fiscal válida (Parameter tipo 'fiscal_responsibility' activo)`,
        );
      }
    }
  }

  /** Atajo: valida régimen y responsabilidades de un mismo payload. */
  async validateSelection(input: {
    billingRegimeTypeId?: number | null;
    billingFiscalResponsibilities?: string[] | null;
  }): Promise<void> {
    await this.validateRegimeType(input.billingRegimeTypeId);
    await this.validateResponsibilities(input.billingFiscalResponsibilities);
  }

  /**
   * Campos que le faltan al perfil para poder emitir una factura electrónica.
   * Devuelve las etiquetas en español, listas para mostrarle al usuario.
   */
  missingForInvoice(profile: BillingProfile, docTypeCode: string | null) {
    const missing: string[] = [];

    const isLegalEntity = isLegalEntityDocument(docTypeCode);
    const hasName = isLegalEntity
      ? !!profile.billingBusinessName?.trim()
      : !!profile.billingName?.trim() && !!profile.billingLastName?.trim();

    if (!hasName) {
      missing.push(isLegalEntity ? 'razón social' : 'nombres y apellidos');
    }
    if (!profile.billingDocTypeId) missing.push('tipo de documento');
    if (!profile.billingDocNumber?.trim()) missing.push('número de documento');
    // La DIAN exige entregarle la factura al adquirente: sin correo no hay envío.
    if (!profile.billingEmail?.trim()) missing.push('correo de facturación');
    if (!profile.billingAddress?.trim()) missing.push('dirección');
    if (!profile.billingCityCode) missing.push('municipio');
    if (!profile.billingRegimeTypeId) missing.push('régimen de IVA');
    if (!profile.billingFiscalResponsibilities?.length) {
      missing.push('responsabilidades fiscales');
    }

    return missing;
  }

  /** Igual que missingForInvoice, pero lanza 400 con el detalle si falta algo. */
  assertReadyToInvoice(
    profile: BillingProfile,
    docTypeCode: string | null,
  ): void {
    const missing = this.missingForInvoice(profile, docTypeCode);
    if (missing.length > 0) {
      throw new BadRequestException(
        `No se puede continuar: faltan datos de facturación (${missing.join(', ')}). ` +
          'Complétalos en el perfil de la empresa.',
      );
    }
  }
}
