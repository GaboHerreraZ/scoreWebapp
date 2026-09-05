import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { StudyDocumentsRepository } from './study-documents.repository.js';
import { PaymentCapacityRepository } from './payment-capacity.repository.js';
import { ParametersRepository } from '../parameters/parameters.repository.js';
import { AiAnalysesService } from '../ai-analyses/ai-analyses.service.js';
import {
  buildMovementClassificationSystemPrompt,
  buildMovementClassificationUserMessage,
} from '../ai/prompts/movement-classification.prompt.js';
import {
  applyClassifications,
  buildClassificationInput,
  countMovements,
  parseClassifications,
} from './classification/movement-classification.js';
import { computeCoverage, type CoverageInfo } from './coverage.js';
import { computePaymentCapacityIndicators } from './indicators/payment-capacity-indicators.js';
import { runPaymentCapacityScoring } from './engine/payment-capacity.engine.js';
import {
  PAYMENT_CAPACITY_DEFAULT_WEIGHTS,
  type PaymentCapacityDimension,
  type PaymentCapacityWeights,
} from './engine/payment-capacity.constants.js';
import {
  validateDepositAccountMatch,
  validateIdentity,
  validateSeriesContinuity,
} from './validation/document-validations.js';
import type {
  BankStatementExtraction,
  ContractorInvoiceExtraction,
  PayrollStubExtraction,
  ReliabilityFlag,
  ValidationOutcome,
} from './extraction/extraction.types.js';
import type {
  CentralRiskInput,
  PdfReliabilityFlag,
} from '../scoring/scoring.types.js';
import { PDF_RELIABILITY_FLAG_CATEGORY_LABEL } from '../scoring/scoring.constants.js';
import { Prisma } from '../../generated/prisma/client.js';

/** Config de scoring vigente (shape mínimo que consume este servicio). */
export interface CapacityScoringConfigLike {
  id: string;
  weights: Array<{
    weight: number;
    dimension: { code: string; label: string };
  }>;
}

/** Etiquetas de categoría de las flags propias del estudio de capacidad (las
 *  de la extracción EEFF vienen de PDF_RELIABILITY_FLAG_CATEGORY_LABEL). */
const CAPACITY_FLAG_CATEGORY_LABEL: Record<string, string> = {
  ...PDF_RELIABILITY_FLAG_CATEGORY_LABEL,
  income: 'Ingreso',
  behavior: 'Comportamiento financiero',
  consistency: 'Consistencia documental',
  indebtedness: 'Endeudamiento',
  validation: 'Validación documental',
  formato: 'Formato del documento',
};

@Injectable()
export class PaymentCapacityService {
  private readonly logger = new Logger(PaymentCapacityService.name);

  constructor(
    private readonly documentsRepository: StudyDocumentsRepository,
    private readonly repository: PaymentCapacityRepository,
    private readonly parametersRepository: ParametersRepository,
    private readonly aiAnalysesService: AiAnalysesService,
  ) {}

  /**
   * REALIZA el estudio de capacidad de pago (branch del performStudy). Pipeline:
   * documentos extraídos → cobertura → validaciones cruzadas (V4/V5/V7) →
   * indicadores (§4) → upsert PaymentCapacityAnalysis → engine de scoring →
   * persistencia del resultado congelado (mismas columnas que el flujo EEFF).
   * Devuelve el estudio actualizado (el llamador arma el step3).
   */
  async perform(params: {
    creditStudyId: string;
    companyId: string;
    userId: string;
    /** Snapshot de la central ya convertido (lo arma credit-studies). */
    centralRisk: CentralRiskInput | null;
    /** Config de scoring vigente (companyId, PN, paymentCapacity) o null. */
    scoringConfig: CapacityScoringConfigLike | null;
  }) {
    const study = await this.documentsRepository.findStudyForDocuments(
      params.creditStudyId,
      params.companyId,
    );
    if (!study) {
      throw new NotFoundException(
        `Estudio de crédito con id=${params.creditStudyId} no encontrado en esta empresa`,
      );
    }

    const employmentType =
      study.employmentType?.code === 'independent' ? 'independent' : 'salaried';

    // ── 1. Documentos extraídos con éxito ──
    const rows = await this.documentsRepository.findByStudyWithExtraction(
      params.creditStudyId,
    );
    const statements: BankStatementExtraction[] = [];
    const stubs: PayrollStubExtraction[] = [];
    const invoices: ContractorInvoiceExtraction[] = [];
    const intraDocValidations: ValidationOutcome[] = [];
    const extractionFlags: ReliabilityFlag[] = [];

    for (const row of rows) {
      const data = row.extractedData as unknown;
      if (!data) continue;
      switch (row.documentType.code) {
        case 'bankStatement':
          statements.push(data as BankStatementExtraction);
          break;
        case 'payrollStub':
          stubs.push(data as PayrollStubExtraction);
          break;
        case 'contractorInvoice':
          invoices.push(data as ContractorInvoiceExtraction);
          break;
      }
      if (Array.isArray(row.validationResults)) {
        intraDocValidations.push(
          ...(row.validationResults as unknown as ValidationOutcome[]),
        );
      }
      if (Array.isArray(row.extractionFlags)) {
        extractionFlags.push(
          ...(row.extractionFlags as unknown as ReliabilityFlag[]),
        );
      }
    }

    // ── 2. Cobertura mínima (3 meses + doc de ingreso) ──
    const coverage = computeCoverage({
      employmentType,
      statementPeriods: statements.map((s) => ({
        from: s.period?.from ?? null,
        to: s.period?.to ?? null,
      })),
      payrollStubs: stubs.length,
      contractorInvoices: invoices.length,
    });
    if (!coverage.complete) {
      throw new BadRequestException(
        `Faltan documentos para analizar: los extractos cubren ${coverage.coveredMonths} de ${coverage.requiredMonths} mes(es) requeridos${
          coverage.incomeDocOk
            ? ''
            : ' y no se ha aportado ningún desprendible de nómina'
        }.`,
      );
    }

    // ── 3. Validaciones cruzadas entre documentos ──
    const crossValidations: ValidationOutcome[] = [
      ...validateSeriesContinuity(statements),
    ];
    const holders = [
      ...statements.map((s) => ({
        source: 'extracto',
        name: s.account?.holderName ?? null,
      })),
      ...stubs.map((p) => ({
        source: 'desprendible',
        name: p.employee?.name ?? null,
      })),
      ...invoices.map((i) => ({
        source: 'factura',
        name: i.contractor?.name ?? null,
      })),
    ];
    crossValidations.push(
      validateIdentity(holders, study.customer.businessName),
    );
    if (stubs.length > 0) {
      crossValidations.push(validateDepositAccountMatch(stubs, statements));
    }

    // ── 3.5 Clasificación consolidada (toda la ventana, un solo criterio) ──
    // Las categorías de la extracción son un borrador hecho PDF por PDF: sin
    // ver los otros meses, el mismo abono puede quedar clasificado distinto en
    // cada uno. Esta llamada recibe todos los movimientos juntos y decide la
    // clasificación definitiva; la transcripción (montos/fechas/saldos, ya
    // verificada por V1–V3) no se toca. Si la pasada falla, el estudio corre
    // igual con el borrador y lo declara en un flag — nunca bloquea.
    let classifiedStatements = statements;
    let classificationFlag: ReliabilityFlag | null = null;
    const totalMovements = countMovements(statements);
    if (totalMovements > 0) {
      try {
        const input = buildClassificationInput(
          statements,
          study.customer.businessName ?? null,
          employmentType,
          invoices,
        );
        const { parsed } = await this.aiAnalysesService.classifyStudyMovements({
          systemPrompt: buildMovementClassificationSystemPrompt(),
          userMessage: buildMovementClassificationUserMessage(input),
          companyId: params.companyId,
          userId: params.userId,
          creditStudyId: params.creditStudyId,
          customerId: study.customer.id,
        });
        const byIndex = parseClassifications(parsed, totalMovements);
        const applied = applyClassifications(statements, byIndex);
        classifiedStatements = applied.statements;
        this.logger.log(
          `Clasificación consolidada: ${applied.changedCount} de ${totalMovements} movimientos reclasificados`,
        );
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : 'error desconocido';
        classificationFlag = {
          severity: 'warning',
          category: 'consistency',
          title: 'Clasificación consolidada no disponible',
          detail: `No se pudo unificar la clasificación de los movimientos entre meses (${reason}). Se usaron las categorías detectadas al leer cada documento por separado, que pueden variar de un mes a otro.`,
        };
      }
    }

    // ── 4. Indicadores (§4 del diseño) ──
    // Sin plazo: los indicadores miden a la persona, no la operación.
    // Cuota mensual según la central: entra al DTI bi-fuente (manda el peor
    // caso entre lo que ve la cuenta y lo que reporta DataCrédito).
    const centralMonthlyQuota =
      params.centralRisk?.reportedIncome != null &&
      params.centralRisk.reportedIncome > 0 &&
      params.centralRisk.quotaToIncomePct != null
        ? Math.round(
            (params.centralRisk.reportedIncome *
              params.centralRisk.quotaToIncomePct) /
              100,
          )
        : null;
    const indicators = computePaymentCapacityIndicators({
      employmentType,
      statements: classifiedStatements,
      payrollStubs: stubs,
      contractorInvoices: invoices,
      declaredEmploymentStartDate: study.declaredEmploymentStartDate
        ? study.declaredEmploymentStartDate.toISOString().slice(0, 10)
        : null,
      centralMonthlyQuota,
    });

    const allValidations = [...intraDocValidations, ...crossValidations];
    const allFlags = [
      ...extractionFlags,
      ...(classificationFlag ? [classificationFlag] : []),
      ...indicators.indicatorFlags,
    ];

    // ── 5. Config de scoring (pesos por empresa desde v1) ──
    const { weights, labels } = params.scoringConfig
      ? this.configToWeights(params.scoringConfig)
      : { weights: PAYMENT_CAPACITY_DEFAULT_WEIGHTS, labels: undefined };

    // ── 6. Motor de scoring (mismo shape ScoringResult) ──
    const result = runPaymentCapacityScoring({
      weights,
      labels,
      request: {
        requestedTerm: study.requestedTerm,
        requestedCreditLine: study.requestedCreditLine,
      },
      employmentType,
      indicators,
      centralRisk: params.centralRisk,
      validationOutcomes: allValidations,
      reliabilityFlags: allFlags,
      recencyOk: coverage.recencyOk,
    });
    result.pdfReliabilityFlags = this.toReliabilityFlagOutput(
      allFlags,
      allValidations,
    );

    // ── 7. Persistir el análisis de capacidad (1:1, upsert) ──
    await this.repository.upsertAnalysis(params.creditStudyId, {
      companyId: params.companyId,
      createdBy: params.userId,
      verifiedMonthlyIncome: indicators.verifiedMonthlyIncome,
      payrollNetIncome: indicators.payrollNetIncome,
      bankStatementIncome: indicators.bankStatementIncome,
      incomeVerificationIndex: indicators.incomeVerificationIndex,
      incomeCv: indicators.incomeCv,
      monthsWithIncome: indicators.monthsWithIncome,
      windowMonths: indicators.windowMonths,
      coveredMonths: indicators.coveredMonths,
      paysOwnSocialSecurity: indicators.paysOwnSocialSecurity,
      verifiedHireDate: indicators.verifiedHireDate
        ? new Date(`${indicators.verifiedHireDate}T00:00:00.000Z`)
        : null,
      recurringFixedExpenses: indicators.recurringFixedExpenses,
      existingDebtPayments: indicators.existingDebtPayments,
      availableIncome: indicators.availableIncome,
      maxSuggestedInstallment: indicators.maxSuggestedInstallment,
      payrollLoanCapacity: indicators.payrollLoanCapacity,
      currentDti: indicators.currentDti,
      // Sin plazo no hay cuota nueva con la cual proyectar. La columna se
      // conserva (nullable) para no migrar por un dato que ya no se calcula.
      projectedDti: null,
      behavior: {
        ...indicators.behavior,
        payroll: indicators.payroll,
        invoiceChecks: indicators.invoiceChecks,
      } as unknown as Prisma.InputJsonValue,
      monthlyIncomeSeries:
        indicators.monthlyIncomeSeries as unknown as Prisma.InputJsonValue,
      detectedObligations:
        indicators.detectedObligations as unknown as Prisma.InputJsonValue,
      crossValidations: allValidations as unknown as Prisma.InputJsonValue,
      reliabilityFlags: allFlags as unknown as Prisma.InputJsonValue,
    });

    // ── 8. Congelar el resultado en el estudio (mismas columnas que EEFF) ──
    const completedStatus =
      await this.parametersRepository.findByCode('studyCompleted');
    return this.repository.updateStudy(params.creditStudyId, {
      viabilityScore: result.summary.totalScore,
      viabilityStatus: result.summary.status,
      viabilityConditions: result as unknown as Prisma.InputJsonValue,
      recommendedCreditLine: result.approvedCreditLine.amount,
      recommendedTerm: study.requestedTerm,
      scoringConfigurationId: params.scoringConfig?.id ?? null,
      ...(completedStatus ? { statusId: completedStatus.id } : {}),
      resolutionDate: new Date(),
      updatedBy: params.userId,
    });
  }

  /**
   * Step 2 del estudio de capacidad: documentos (resumen, sin movimientos) +
   * cobertura + el análisis de capacidad persistido (si ya corrió el perform).
   * null si aún no se ha subido ningún documento (paso no iniciado).
   */
  async buildDocumentsStep(creditStudyId: string, companyId: string) {
    const study = await this.documentsRepository.findStudyForDocuments(
      creditStudyId,
      companyId,
    );
    if (!study) return null;

    const documents = await this.documentsRepository.findByStudy(creditStudyId);
    if (documents.length === 0) return null;

    const success = documents.filter((d) => d.extractionStatus === 'success');
    const coverage: CoverageInfo = computeCoverage({
      employmentType:
        study.employmentType?.code === 'independent'
          ? 'independent'
          : 'salaried',
      statementPeriods: success
        .filter((d) => d.documentType.code === 'bankStatement')
        .map((d) => ({
          from: d.periodFrom ? d.periodFrom.toISOString().slice(0, 10) : null,
          to: d.periodTo ? d.periodTo.toISOString().slice(0, 10) : null,
        })),
      payrollStubs: success.filter((d) => d.documentType.code === 'payrollStub')
        .length,
      contractorInvoices: success.filter(
        (d) => d.documentType.code === 'contractorInvoice',
      ).length,
    });

    const analysis = await this.repository.findAnalysisByStudy(creditStudyId);

    return { documents, coverage, analysis };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private configToWeights(config: CapacityScoringConfigLike): {
    weights: PaymentCapacityWeights;
    labels: Partial<Record<PaymentCapacityDimension, string>>;
  } {
    const weights: PaymentCapacityWeights = {};
    const labels: Partial<Record<PaymentCapacityDimension, string>> = {};
    for (const row of config.weights) {
      weights[row.dimension.code as PaymentCapacityDimension] = row.weight;
      labels[row.dimension.code as PaymentCapacityDimension] =
        row.dimension.label;
    }
    return { weights, labels };
  }

  /**
   * Flags de extracción/indicadores + validaciones FALLIDAS → shape estable
   * pdfReliabilityFlags del resultado (el mismo panel del front que en EEFF).
   */
  private toReliabilityFlagOutput(
    flags: ReliabilityFlag[],
    validations: ValidationOutcome[],
  ): PdfReliabilityFlag[] {
    const fromFlags: PdfReliabilityFlag[] = flags.map((f) => {
      const category = f.category || 'otro';
      return {
        severity: (f.severity as PdfReliabilityFlag['severity']) ?? 'info',
        category,
        categoryLabel: CAPACITY_FLAG_CATEGORY_LABEL[category] ?? category,
        title: f.title,
        detail: f.detail,
      };
    });
    const fromValidations: PdfReliabilityFlag[] = validations
      .filter((v) => v.passed === false)
      .map((v) => ({
        severity: v.severity,
        category: 'validation',
        categoryLabel: CAPACITY_FLAG_CATEGORY_LABEL.validation,
        title: `Validación ${v.code} fallida: ${v.label}`,
        detail: v.detail,
      }));
    return [...fromFlags, ...fromValidations];
  }
}
