import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import Handlebars from 'handlebars';

/** Una venta comisionada, tal como sale en el comprobante. */
export interface PayoutReceiptLine {
  month: string;
  date: string;
  company: string;
  kind: string;
  base: string;
  gross: string;
  discount: string;
  amount: string;
}

export interface PayoutReceiptView {
  reference: string;
  paidAt: string;
  period: string;
  salesRepCode: string;
  salesRepName: string;
  salesRepEmail: string;
  commissionCount: number;
  totalAmount: string;
  currencyCode: string;
  notes: string | null;
  /** true si el vendedor financió descuentos: cambia el texto explicativo. */
  hasDiscounts: boolean;
  totalDiscounts: string;
  totalGross: string;
  lines: PayoutReceiptLine[];
}

/**
 * Plantilla compilada una sola vez. El .html se copia junto al build vía los
 * assets de nest-cli (mismo mecanismo que el informe de estudio de crédito).
 */
let compiled: Handlebars.TemplateDelegate | null = null;

function getTemplate(): Handlebars.TemplateDelegate {
  if (compiled) return compiled;
  const here = dirname(fileURLToPath(import.meta.url));
  const templatePath = join(
    here,
    'templates',
    'commission-payout-receipt.template.html',
  );
  compiled = Handlebars.compile(readFileSync(templatePath, 'utf-8'));
  return compiled;
}

export function renderPayoutReceiptHtml(data: PayoutReceiptView): string {
  return getTemplate()(data);
}
