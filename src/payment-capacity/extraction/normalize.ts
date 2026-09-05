// ─── Normalización post-extracción (en código, no en el prompt) ────────────
// La IA devuelve el JSON del contrato; aquí se endurece: tipos coaccionados,
// arrays garantizados y presencia de lo crítico verificada. Si falta lo
// esencial se lanza BadRequest con un mensaje accionable (mejor que persistir
// una extracción a medias que después reviente los indicadores).

import { BadRequestException } from '@nestjs/common';
import type {
  BankMovement,
  BankStatementExtraction,
  ContractorInvoiceExtraction,
  MovementCategory,
  PayrollStubExtraction,
} from './extraction.types.js';
import { MOVEMENT_CATEGORIES } from './extraction.types.js';

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

const isIsoDate = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function normalizeBankStatement(
  parsed: Record<string, unknown>,
): BankStatementExtraction {
  const account = (parsed.account ?? {}) as Record<string, unknown>;
  const period = (parsed.period ?? {}) as Record<string, unknown>;
  const summary = (parsed.summary ?? {}) as Record<string, unknown>;
  const movementsRaw = Array.isArray(parsed.movements) ? parsed.movements : [];

  if (!isIsoDate(period.from) || !isIsoDate(period.to)) {
    throw new BadRequestException(
      'La extracción no identificó el período del extracto (DESDE/HASTA). Verifica que el PDF sea el original del banco.',
    );
  }
  if (movementsRaw.length === 0) {
    throw new BadRequestException(
      'La extracción no encontró movimientos en el extracto. Verifica que el PDF sea legible y completo.',
    );
  }

  const movements: BankMovement[] = movementsRaw.map((m) => {
    const row = m as Record<string, unknown>;
    const category = str(row.category) ?? 'unknown';
    return {
      date: isIsoDate(row.date)
        ? row.date
        : typeof row.date === 'string'
          ? row.date
          : '',
      rawDescription: str(row.rawDescription) ?? '',
      amount: num(row.amount) ?? 0,
      balance: num(row.balance) ?? 0,
      category: (MOVEMENT_CATEGORIES as readonly string[]).includes(category)
        ? (category as MovementCategory)
        : 'unknown',
      counterparty: str(row.counterparty),
    };
  });

  const last4Raw = str(account.accountNumberLast4);

  return {
    docType: 'bank_statement',
    account: {
      bank: str(account.bank) ?? 'Desconocido',
      accountType: str(account.accountType) ?? 'savings',
      accountNumberLast4: last4Raw
        ? last4Raw.replace(/\D/g, '').slice(-4)
        : null,
      holderName: str(account.holderName),
      branch: str(account.branch),
    },
    period: { from: period.from, to: period.to },
    summary: {
      previousBalance: num(summary.previousBalance),
      totalCredits: num(summary.totalCredits),
      totalDebits: num(summary.totalDebits),
      finalBalance: num(summary.finalBalance),
      averageBalance: num(summary.averageBalance),
      interestPaid: num(summary.interestPaid),
      withholding: num(summary.withholding),
    },
    movements,
  };
}

export function normalizePayrollStub(
  parsed: Record<string, unknown>,
): PayrollStubExtraction {
  const employer = (parsed.employer ?? {}) as Record<string, unknown>;
  const employee = (parsed.employee ?? {}) as Record<string, unknown>;
  const funds = (parsed.funds ?? {}) as Record<string, unknown>;
  const deposit = parsed.depositAccount as Record<string, unknown> | null;
  const totals = (parsed.totals ?? {}) as Record<string, unknown>;
  const signature = parsed.signature as Record<string, unknown> | null;
  const conceptsRaw = Array.isArray(parsed.concepts) ? parsed.concepts : [];

  if (num(parsed.netPay) === null) {
    throw new BadRequestException(
      'La extracción no identificó el neto a pagar del desprendible. Verifica que el PDF sea legible.',
    );
  }

  const last4Raw = deposit ? str(deposit.accountNumberLast4) : null;

  return {
    docType: 'payroll_stub',
    employer: { name: str(employer.name), nit: str(employer.nit) },
    employee: {
      name: str(employee.name),
      idType: str(employee.idType),
      idNumber: str(employee.idNumber),
      employeeNumber: str(employee.employeeNumber),
      position: str(employee.position),
      division: str(employee.division),
    },
    period: str(parsed.period),
    hireDate: isIsoDate(parsed.hireDate) ? parsed.hireDate : null,
    baseSalary: num(parsed.baseSalary),
    funds: {
      health: str(funds.health),
      pension: str(funds.pension),
      severance: str(funds.severance),
    },
    depositAccount: deposit
      ? {
          bank: str(deposit.bank),
          accountType: str(deposit.accountType),
          accountNumberLast4: last4Raw
            ? last4Raw.replace(/\D/g, '').slice(-4)
            : null,
        }
      : null,
    concepts: conceptsRaw.map((c) => {
      const row = c as Record<string, unknown>;
      return {
        code: str(row.code),
        concept: str(row.concept) ?? '',
        quantity: num(row.quantity),
        earning: num(row.earning),
        deduction: num(row.deduction),
      };
    }),
    totals: {
      earnings: num(totals.earnings),
      deductions: num(totals.deductions),
    },
    netPay: num(parsed.netPay),
    netPayInWords: str(parsed.netPayInWords),
    signature: signature
      ? {
          signed: signature.signed === true,
          timestamp: str(signature.timestamp),
        }
      : null,
  };
}

export function normalizeContractorInvoice(
  parsed: Record<string, unknown>,
): ContractorInvoiceExtraction {
  const contractor = (parsed.contractor ?? {}) as Record<string, unknown>;
  const client = (parsed.client ?? {}) as Record<string, unknown>;
  const period = parsed.period as Record<string, unknown> | null;
  const lineItemsRaw = Array.isArray(parsed.lineItems) ? parsed.lineItems : [];

  if (num(parsed.total) === null) {
    throw new BadRequestException(
      'La extracción no identificó el total de la factura. Verifica que el PDF sea legible.',
    );
  }

  return {
    docType: 'contractor_invoice',
    invoiceNumber: str(parsed.invoiceNumber),
    issueDate: isIsoDate(parsed.issueDate) ? parsed.issueDate : null,
    period:
      period && isIsoDate(period.from) && isIsoDate(period.to)
        ? { from: period.from, to: period.to }
        : null,
    contractor: {
      name: str(contractor.name),
      phone: str(contractor.phone),
      city: str(contractor.city),
    },
    client: { name: str(client.name), country: str(client.country) },
    role: str(parsed.role),
    currency: str(parsed.currency) ?? 'COP',
    lineItems: lineItemsRaw.map((li) => {
      const row = li as Record<string, unknown>;
      return {
        description: str(row.description) ?? '',
        amount: num(row.amount) ?? 0,
      };
    }),
    total: num(parsed.total),
    approvedBy: str(parsed.approvedBy),
  };
}
