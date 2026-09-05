// ─── Formas normalizadas de la extracción por documento ─────────────────────
// Espejo tipado de los schemas del doc de extracción
// (docs/estudio-persona-natural-extraccion.md §2, §4 y §5). Es lo que se
// persiste en StudyDocument.extractedData y lo que consumen las validaciones
// (V1–V10) y el módulo de indicadores. Los prompts producen exactamente esto.

import type { ReliabilityFlag } from '../../ai-analyses/ai-analyses.service.js';

/** Categorías de movimiento (taxonomía §3). El prompt etiqueta la categoría
 *  base; la clasificación fina (cuota probable, recurrencia) se decide en
 *  código. `unknown` es respuesta válida: prohibido inventar. */
export const MOVEMENT_CATEGORIES = [
  'income_international',
  'income_payroll',
  'income_other',
  'self_transfer_in',
  'self_transfer_out',
  'wallet_transfer',
  'cc_payment',
  'cc_cash_in',
  'loan_payment',
  'social_security',
  'pension_savings',
  'utilities',
  'telecom',
  'health',
  'education',
  'insurance',
  'rent',
  'subscription',
  'groceries',
  'transport',
  'purchase',
  'atm_withdrawal',
  'recurring_transfer_out',
  'bank_fee',
  'tax',
  'interest',
  'gambling',
  'unknown',
] as const;

export type MovementCategory = (typeof MOVEMENT_CATEGORIES)[number];

export interface BankMovement {
  /** Fecha ISO (YYYY-MM-DD), año resuelto contra el período del encabezado. */
  date: string;
  rawDescription: string;
  /** Con signo: abono +, cargo −. */
  amount: number;
  /** Saldo corrido TRAS el movimiento (habilita la validación V1). */
  balance: number;
  category: MovementCategory;
  /** Contraparte identificada ("NEQUI", "FINESA S.A.", "SKANDIA"…) o null. */
  counterparty: string | null;
}

export interface BankStatementExtraction {
  docType: 'bank_statement';
  account: {
    bank: string;
    /** 'savings' | 'checking' | 'wallet' u otro literal del banco. */
    accountType: string;
    accountNumberLast4: string | null;
    /** Titular tal cual aparece (puede venir truncado o con mojibake). */
    holderName: string | null;
    branch: string | null;
  };
  period: { from: string; to: string };
  /** El bloque RESUMEN lo trae el banco: se extrae, no se calcula. */
  summary: {
    previousBalance: number | null;
    totalCredits: number | null;
    /** Valor absoluto. */
    totalDebits: number | null;
    finalBalance: number | null;
    /** Lo calcula el banco cuando aparece: úsese directo. */
    averageBalance: number | null;
    interestPaid: number | null;
    withholding: number | null;
  };
  movements: BankMovement[];
}

// ─── Desprendible de nómina (§5) ───────────────────────────────────────────

export interface PayrollConcept {
  code: string | null;
  concept: string;
  quantity: number | null;
  earning: number | null;
  deduction: number | null;
}

export interface PayrollStubExtraction {
  docType: 'payroll_stub';
  employer: { name: string | null; nit: string | null };
  employee: {
    name: string | null;
    idType: string | null;
    /** Tal cual aparece; normalizar guiones en código. */
    idNumber: string | null;
    employeeNumber: string | null;
    position: string | null;
    division: string | null;
  };
  /** Período en formato YYYY-MM. */
  period: string | null;
  /** Fecha de Ingreso cuando aparece: antigüedad VERIFICADA. */
  hireDate: string | null;
  baseSalary: number | null;
  funds: {
    health: string | null;
    pension: string | null;
    severance: string | null;
  };
  /** Dónde le consignan: cruza contra el extracto (validación V7). */
  depositAccount: {
    bank: string | null;
    accountType: string | null;
    accountNumberLast4: string | null;
  } | null;
  concepts: PayrollConcept[];
  totals: { earnings: number | null; deductions: number | null };
  netPay: number | null;
  netPayInWords: string | null;
  signature: { signed: boolean; timestamp: string | null } | null;
}

// ─── Factura de contratista (§4) ───────────────────────────────────────────

export interface ContractorInvoiceExtraction {
  docType: 'contractor_invoice';
  invoiceNumber: string | null;
  issueDate: string | null;
  period: { from: string; to: string } | null;
  contractor: {
    name: string | null;
    phone: string | null;
    city: string | null;
  };
  client: { name: string | null; country: string | null };
  role: string | null;
  currency: string;
  lineItems: Array<{ description: string; amount: number }>;
  total: number | null;
  approvedBy: string | null;
}

/** Unión discriminada de las tres extracciones. */
export type StudyDocumentExtraction =
  | BankStatementExtraction
  | PayrollStubExtraction
  | ContractorInvoiceExtraction;

/** Codes del Parameter study_document_type. */
export const STUDY_DOCUMENT_TYPES = [
  'bankStatement',
  'payrollStub',
  'contractorInvoice',
] as const;
export type StudyDocumentTypeCode = (typeof STUDY_DOCUMENT_TYPES)[number];

/** Resultado de una validación determinística (V1–V10). `passed: null` =
 *  no evaluable con los datos disponibles (no penaliza, se declara). */
export interface ValidationOutcome {
  code: 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6' | 'V7' | 'V8' | 'V9' | 'V10';
  label: string;
  passed: boolean | null;
  severity: 'danger' | 'warning' | 'info';
  detail: string;
}

export type { ReliabilityFlag };
