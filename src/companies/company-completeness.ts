import { BadRequestException } from '@nestjs/common';

/**
 * Campos operativos de la empresa que el onboarding ya no pide y que ciertas
 * funciones exigen después (estudios/autorizaciones → NIT; pagaré → dirección
 * y ciudad). El front reconoce el code COMPANY_DATA_INCOMPLETE y ofrece el
 * redirect a Administración → Empresa.
 */
export interface CompanyCoreData {
  nit: string | null;
  sectorId: number | null;
  cityCode: string | null;
  address: string | null;
}

export const COMPANY_DATA_INCOMPLETE = 'COMPANY_DATA_INCOMPLETE';

const FIELD_LABELS: Record<keyof CompanyCoreData, string> = {
  nit: 'NIT',
  sectorId: 'sector',
  cityCode: 'ciudad',
  address: 'dirección',
};

/** Claves de los campos operativos que faltan (null o en blanco). */
export function missingCompanyData(
  company: CompanyCoreData,
): (keyof CompanyCoreData)[] {
  return (Object.keys(FIELD_LABELS) as (keyof CompanyCoreData)[]).filter(
    (key) => {
      const value = company[key];
      return value == null || (typeof value === 'string' && !value.trim());
    },
  );
}

/** 400 estructurado; `missingFields` lleva claves de campo, no etiquetas. */
export function companyDataIncompleteException(
  missingFields: string[],
  missingLabels: string[],
  action: string,
): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    code: COMPANY_DATA_INCOMPLETE,
    missingFields,
    message:
      `Para ${action} primero completa los datos de tu empresa ` +
      `(falta: ${missingLabels.join(', ')}). Puedes hacerlo en ` +
      'Administración → Empresa.',
  });
}

/** Etiqueta en español de un campo operativo (para armar mensajes). */
export function companyFieldLabel(field: keyof CompanyCoreData): string {
  return FIELD_LABELS[field];
}

/**
 * Acumula campos requeridos que faltan y lanza el 400 estructurado
 * (COMPANY_DATA_INCOMPLETE) con todos de una sola vez.
 */
export class MissingFieldCollector {
  private readonly fields: string[] = [];
  private readonly labels: string[] = [];

  /** Registra el campo como faltante cuando ok es false. */
  require(ok: boolean, field: string, label: string): this {
    if (!ok) {
      this.fields.push(field);
      this.labels.push(label);
    }
    return this;
  }

  /** Lanza companyDataIncompleteException si algún require falló. */
  assertComplete(action: string): void {
    if (this.fields.length > 0) {
      throw companyDataIncompleteException(this.fields, this.labels, action);
    }
  }
}
