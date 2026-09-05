import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { AiAnalysesRepository } from './ai-analyses.repository.js';
import {
  AiService,
  type AiCompletionResult,
  type ExtractionKind,
} from '../ai/ai.service.js';
import { ParametersRepository } from '../parameters/parameters.repository.js';
import {
  buildFinancialPdfExtractionPrompt,
  CREDIT_STUDY_SYSTEM_PROMPT,
  buildCreditStudyUserMessage,
  type CreditStudyPromptInput,
  type PromptFinancialSource,
} from '../ai/prompts/credit-study-analysis.prompt.js';
import {
  PAYMENT_CAPACITY_SYSTEM_PROMPT,
  buildPaymentCapacityUserMessage,
  type PaymentCapacityPromptInput,
} from '../ai/prompts/payment-capacity-analysis.prompt.js';
import { scoreToBand } from '../scoring/scoring.constants.js';
import { FilterAiAnalysisDto } from './dto/filter-ai-analysis.dto.js';
import { Prisma } from '../../generated/prisma/client.js';

/** Red flag de fiabilidad que la IA detecta al analizar el PDF. */
export interface ReliabilityFlag {
  severity: string;
  category: string;
  title: string;
  detail: string;
}

/** Forma cruda que devuelve la IA al extraer el PDF (antes de normalizar). */
interface ExtractPdfResponse {
  financialData?: Record<string, unknown>;
  reliabilityFlags?: ReliabilityFlag[];
}

/** Resultado de extractPdf: cifras normalizadas + red flags. */
export interface ExtractPdfResult {
  financialData: Record<string, unknown>;
  reliabilityFlags: ReliabilityFlag[];
  extractionId: string;
}

/** Métricas de la corrida IA (modelo, tokens, costo) para el modo de prueba. */
export interface AiRunUsage {
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  durationMs: number | null;
}

/** Resultado de la extracción SIN persistir (prueba del portal admin). */
export interface ExtractPdfDryRunResult {
  financialData: Record<string, unknown>;
  reliabilityFlags: ReliabilityFlag[];
  usage: AiRunUsage;
  /** Texto crudo que devolvió el modelo, para depurar el prompt. */
  rawContent: string | null;
}

/**
 * Forma (parcial) del ScoringResult persistido en CreditStudy.viabilityConditions
 * por performStudy. Solo lo que el prompt IA consume; se lee como JSON.
 */
interface ScoringResultShape {
  dimensions: Record<
    string,
    {
      label: string;
      ratio: number | null;
      weight: number;
      contribution: number;
      status: string;
      evaluable: boolean;
    }
  >;
  alerts: Array<{ type: string; dimension: string; message: string }>;
  approvedCreditLine?: {
    amount: number | null;
    requested: number | null;
    suggestedByBureau: number | null;
    cappedByCapacity: boolean;
  };
  keyFigures?: {
    monthlyPaymentCapacity: number;
    annualPaymentCapacity: number;
    /** Nuevas (pago único). Opcionales: resultados congelados ANTES del cambio
     *  no las traen — normalizeKeyFigures las deriva. */
    paymentAtMaturity?: number;
    capacityInTerm?: number;
    /** Legado (resultados congelados con el modelo de cuota mensual). */
    estimatedMonthlyQuota?: number;
    paymentCoverageRatio: number | null;
    currentDebtService: number;
    ebitda: number;
    accountsReceivableTurnover: number;
    inventoryTurnover: number;
    paymentTimeSuppliers: number;
    cashConversionCycle: number;
    stabilityFactor: number;
  };
  summary?: {
    calculationSource: 'datacredito' | 'pdf' | 'none';
    financialsVerified: boolean;
    eliminatoryReason?: string | null;
  };
  pdfReliabilityFlags?: Array<{
    severity: string;
    category: string;
    title: string;
    detail: string;
  }>;
  centralRiskFlags?: Array<{
    severity: string;
    category: string;
    title: string;
    detail: string;
  }>;
  /** Bloque propio del estudio de capacidad de pago (solo en ese tipo). */
  capacityFigures?: PaymentCapacityPromptInput['capacityFigures'] & {
    employmentType?: 'salaried' | 'independent';
  };
}

@Injectable()
export class AiAnalysesService {
  private readonly logger = new Logger(AiAnalysesService.name);

  constructor(
    private readonly repository: AiAnalysesRepository,
    private readonly aiService: AiService,
    private readonly parametersRepository: ParametersRepository,
  ) {}

  private async getTypeId(code: string): Promise<number> {
    const param = await this.parametersRepository.findByCode(code);
    if (!param) {
      throw new NotFoundException(
        `Parametro con codigo="${code}" no encontrado. Debe crearse en la tabla de parametros.`,
      );
    }
    return param.id;
  }

  /**
   * Genera el INFORME EJECUTIVO IA de un estudio ya realizado (modelo v2). Lee el
   * ScoringResult persistido (viabilityConditions: score, 7 dimensiones
   * ponderadas, alertas, monto aprobado, red flags del PDF), las dos fuentes de
   * EEFF (PDF y/o DataCrédito) y el snapshot de la central, y arma un prompt
   * consciente del tipo de persona (PN/PJ). Registra la corrida en AiAnalysis.
   */
  async analyze(creditStudyId: string, companyId: string, userId: string) {
    // 1. Tipo de análisis (creditReview).
    const typeId = await this.getTypeId('creditReview');

    // 2. Cargar el estudio con todo lo necesario para el modelo v2.
    const inputs = await this.repository.findStudyForAiAnalysis(
      creditStudyId,
      companyId,
    );
    if (!inputs) {
      throw new NotFoundException(
        `Estudio de credito con id=${creditStudyId} no encontrado en esta empresa`,
      );
    }
    const { study, analyses, riskSnapshot, capacityAnalysis } = inputs;
    const customer = study.customer;

    // 3. El estudio debe estar realizado (tiene el ScoringResult persistido).
    if (
      study.viabilityScore === null ||
      !study.viabilityStatus ||
      !study.viabilityConditions
    ) {
      throw new BadRequestException(
        'El estudio de credito debe ser realizado antes de ejecutar el analisis con IA. Ejecute primero el endpoint de realizar estudio.',
      );
    }

    // 4. El IA va incluido en el estudio: el crédito ya se consumió al crear el
    //    CreditStudy (modelo de bolsas). No hay límite adicional por suscripción.

    // 5. Armar la entrada del prompt desde el ScoringResult + fuentes + central.
    const result = study.viabilityConditions as unknown as ScoringResultShape;
    const isLegalEntity = customer.personType?.code === 'legalEntity';

    // ── Branch: narrativa del estudio de capacidad de pago ──
    // Misma corrida (registro en AiAnalysis con typeId creditReview, que los
    // steps adjuntan sin cambios); cambia el prompt: indicadores de flujo de
    // caja + validaciones documentales en lugar de fuentes de EEFF.
    if (study.studyType?.code === 'paymentCapacity') {
      const capacityMessage = this.buildCapacityNarrativeMessage(
        study,
        result,
        riskSnapshot,
        capacityAnalysis,
      );
      return this.runNarrative({
        typeId,
        companyId,
        customerId: study.customerId,
        creditStudyId,
        userId,
        systemPrompt: PAYMENT_CAPACITY_SYSTEM_PROMPT,
        userMessage: capacityMessage,
      });
    }

    const financialSources: PromptFinancialSource[] = analyses.map((a) => ({
      source: a.source === 'datacredito' ? 'datacredito' : 'pdf_upload',
      periods: a.periods.map((p) => ({
        fiscalYear: p.fiscalYear,
        ordinaryActivityRevenue: p.ordinaryActivityRevenue,
        costOfSales: p.costOfSales,
        grossProfit: p.grossProfit,
        netIncome: p.netIncome,
        totalAssets: p.totalAssets,
        totalLiabilities: p.totalLiabilities,
        equity: p.equity,
      })),
      indicators: {
        ebitda: a.ebitda,
        adjustedEbitda: a.adjustedEbitda,
        stabilityFactor: a.stabilityFactor,
        currentDebtService: a.currentDebtService,
        monthlyPaymentCapacity: a.monthlyPaymentCapacity,
        annualPaymentCapacity: a.annualPaymentCapacity,
        accountsReceivableTurnover: a.accountsReceivableTurnover,
        inventoryTurnover: a.inventoryTurnover,
        paymentTimeSuppliers: a.paymentTimeSuppliers,
      },
    }));

    const promptInput: CreditStudyPromptInput = {
      customerName: customer.businessName,
      customerCity:
        customer.daneCity?.name ?? customer.bureauCity ?? 'No especificada',
      isLegalEntity,
      personTypeLabel:
        customer.personType?.description ??
        customer.personType?.label ??
        (isLegalEntity ? 'Persona Juridica' : 'Persona Natural'),
      requestedTerm: study.requestedTerm ?? 0,
      requestedCreditLine: study.requestedCreditLine ?? 0,
      viabilityScore: study.viabilityScore,
      viabilityStatus: study.viabilityStatus,
      approvedCreditLine: result.approvedCreditLine ?? {
        amount: study.recommendedCreditLine ?? null,
        requested: study.requestedCreditLine ?? null,
        suggestedByBureau: riskSnapshot?.montoSugerido ?? null,
        cappedByCapacity: false,
      },
      calculationSource: result.summary?.calculationSource ?? 'none',
      financialsVerified: result.summary?.financialsVerified ?? false,
      keyFigures: this.normalizeKeyFigures(result.keyFigures, study),
      financialSources,
      centralRisk: riskSnapshot
        ? {
            score: riskSnapshot.score,
            scoreBandLabel:
              riskSnapshot.score !== null
                ? scoreToBand(riskSnapshot.score).label
                : null,
            nivelRiesgo: riskSnapshot.nivelRiesgo,
            ratingSectorial: riskSnapshot.ratingSectorial,
            hasArrears: this.detectArrears(riskSnapshot.paymentBehavior),
            montoSugerido: riskSnapshot.montoSugerido,
          }
        : null,
      dimensions: result.dimensions ?? {},
      alerts: result.alerts ?? [],
      eliminatoryReason: result.summary?.eliminatoryReason ?? null,
      pdfReliabilityFlags: result.pdfReliabilityFlags ?? [],
      centralRiskFlags: result.centralRiskFlags ?? [],
    };

    const userMessage = buildCreditStudyUserMessage(promptInput);
    return this.runNarrative({
      typeId,
      companyId,
      customerId: study.customerId,
      creditStudyId,
      userId,
      systemPrompt: CREDIT_STUDY_SYSTEM_PROMPT,
      userMessage,
    });
  }

  /**
   * Corrida compartida del INFORME EJECUTIVO IA (EEFF y capacidad): llama al
   * modelo, registra la corrida en AiAnalysis (éxito o error) y devuelve la
   * fila. Sin notificación: el análisis corre dentro del wizard con el usuario
   * esperando el resultado en pantalla.
   */
  private async runNarrative(params: {
    typeId: number;
    companyId: string;
    customerId: string;
    creditStudyId: string;
    userId: string;
    systemPrompt: string;
    userMessage: string;
  }) {
    const fullPrompt = `[SYSTEM]\n${params.systemPrompt}\n\n[USER]\n${params.userMessage}`;
    try {
      const aiResult = await this.aiService.generateCompletion(
        params.systemPrompt,
        params.userMessage,
      );

      const estimatedCostUsd = this.aiService.estimateCostUsd(
        aiResult.model,
        aiResult.promptTokens,
        aiResult.completionTokens,
      );

      return await this.repository.create({
        typeId: params.typeId,
        companyId: params.companyId,
        customerId: params.customerId,
        creditStudyId: params.creditStudyId,
        performedBy: params.userId,
        prompt: fullPrompt,
        result: aiResult.content,
        model: aiResult.model,
        promptTokens: aiResult.promptTokens,
        completionTokens: aiResult.completionTokens,
        totalTokens: aiResult.totalTokens,
        estimatedCostUsd,
        durationMs: aiResult.durationMs,
        status: 'success',
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Error desconocido';

      this.logger.error(
        `Analisis IA fallido para estudio de credito ${params.creditStudyId}`,
        error,
      );

      await this.repository.create({
        typeId: params.typeId,
        companyId: params.companyId,
        customerId: params.customerId,
        creditStudyId: params.creditStudyId,
        performedBy: params.userId,
        prompt: fullPrompt,
        result: null,
        model: 'unknown',
        status: 'error',
        errorMessage,
      });

      throw new BadRequestException(`El analisis IA fallo: ${errorMessage}`);
    }
  }

  /**
   * Arma el mensaje de usuario de la narrativa del estudio de CAPACIDAD desde
   * el resultado congelado (capacityFigures incluidas) + el análisis de
   * capacidad persistido (obligaciones/comportamiento) + la central.
   */
  private buildCapacityNarrativeMessage(
    study: {
      requestedTerm: number | null;
      requestedCreditLine: number | null;
      viabilityScore: number | null;
      viabilityStatus: string | null;
      recommendedCreditLine: number | null;
      employmentType: { code: string; label: string } | null;
      customer: {
        businessName: string;
        bureauCity: string | null;
        daneCity: { name: string } | null;
      };
    },
    result: ScoringResultShape,
    riskSnapshot: {
      score: number | null;
      viabilidad: string | null;
      montoSugerido: number | null;
      paymentBehavior: unknown;
    } | null,
    capacityAnalysis: {
      detectedObligations: unknown;
      behavior: unknown;
    } | null,
  ): string {
    const cf = result.capacityFigures;
    if (!cf) {
      throw new BadRequestException(
        'El resultado congelado del estudio no trae las cifras de capacidad. Vuelva a realizar el estudio.',
      );
    }

    const obligationsRaw = capacityAnalysis?.detectedObligations;
    const detectedObligations = Array.isArray(obligationsRaw)
      ? (obligationsRaw as PaymentCapacityPromptInput['detectedObligations'])
      : [];
    const behaviorRaw = capacityAnalysis?.behavior as Record<
      string,
      unknown
    > | null;
    const behavior = behaviorRaw
      ? {
          averageBalance: (behaviorRaw.averageBalance as number | null) ?? null,
          daysNegative: (behaviorRaw.daysNegative as number) ?? 0,
          daysAtZero: (behaviorRaw.daysAtZero as number) ?? 0,
          pctWithdrawn48h:
            (behaviorRaw.pctWithdrawn48h as number | null) ?? null,
          gamblingPctOfIncome:
            (behaviorRaw.gamblingPctOfIncome as number | null) ?? null,
          walletTransfersCount:
            (behaviorRaw.walletTransfersCount as number) ?? 0,
        }
      : null;

    const input: PaymentCapacityPromptInput = {
      customerName: study.customer.businessName,
      customerCity:
        study.customer.daneCity?.name ??
        study.customer.bureauCity ??
        'No especificada',
      employmentTypeLabel:
        study.employmentType?.label ??
        (cf.employmentType === 'independent' ? 'Independiente' : 'Asalariado'),
      requestedCreditLine: study.requestedCreditLine ?? 0,
      viabilityScore: study.viabilityScore ?? 0,
      viabilityStatus: study.viabilityStatus ?? 'rejected',
      approvedCreditLine: result.approvedCreditLine ?? {
        amount: study.recommendedCreditLine ?? null,
        requested: study.requestedCreditLine ?? null,
        suggestedByBureau: riskSnapshot?.montoSugerido ?? null,
        cappedByCapacity: false,
      },
      capacityFigures: cf,
      detectedObligations,
      behavior,
      centralRisk: riskSnapshot
        ? {
            score: riskSnapshot.score,
            scoreBandLabel:
              riskSnapshot.score !== null
                ? scoreToBand(riskSnapshot.score).label
                : null,
            viabilidad: riskSnapshot.viabilidad,
            hasArrears: this.detectArrears(riskSnapshot.paymentBehavior),
            montoSugerido: riskSnapshot.montoSugerido,
          }
        : null,
      dimensions: result.dimensions ?? {},
      alerts: result.alerts ?? [],
      eliminatoryReason: result.summary?.eliminatoryReason ?? null,
      reliabilityFlags: result.pdfReliabilityFlags ?? [],
      centralRiskFlags: result.centralRiskFlags ?? [],
    };
    return buildPaymentCapacityUserMessage(input);
  }

  /**
   * Corre la extracción IA sobre un PDF de estados financieros y registra la
   * corrida en la tabla AiAnalysis (log central de IA: tokens, costo, PDF
   * binario). Devuelve las cifras y las red flags para que el llamador
   * (FinancialStatementsService) las persista como períodos + análisis.
   *
   * El estudio ya existe en el flujo nuevo, así que la fila de AiAnalysis nace
   * ya ligada a él (creditStudyId/customerId). El crédito se consumió al crear
   * el estudio (modelo de bolsas), así que aquí no hay cobro.
   */
  async extractPdf(
    pdfBuffer: Buffer,
    companyId: string,
    userId: string,
    context?: { creditStudyId?: string; customerId?: string },
  ): Promise<ExtractPdfResult> {
    // 1. Get extraction type parameter
    const typeId = await this.getTypeId('financialStatementsPdfUpload');

    // El prompt se construye con la fecha actual: la flag de "verificabilidad"
    // (período aún no reportado ante las entidades) depende del mes de carga.
    const extractionPrompt = buildFinancialPdfExtractionPrompt(new Date());

    // 2. Call Claude AI to extract data from PDF
    try {
      const { aiResult, financialData, reliabilityFlags, estimatedCostUsd } =
        await this.runPdfExtraction(pdfBuffer, extractionPrompt);

      // 3. Save the extraction record with the PDF file. En el flujo nuevo el
      //    estudio ya existe, así que la fila queda ligada a él de una vez.
      const extraction = await this.repository.create({
        typeId,
        companyId,
        creditStudyId: context?.creditStudyId,
        customerId: context?.customerId,
        performedBy: userId,
        prompt: extractionPrompt,
        pdfFile: new Uint8Array(pdfBuffer),
        result: aiResult.content,
        model: aiResult.model,
        promptTokens: aiResult.promptTokens,
        completionTokens: aiResult.completionTokens,
        totalTokens: aiResult.totalTokens,
        estimatedCostUsd,
        durationMs: aiResult.durationMs,
        status: 'success',
      });

      // Sin notificación: la extracción es un paso síncrono del wizard (el
      // usuario está mirando el resultado); notificar era ruido.
      return { financialData, reliabilityFlags, extractionId: extraction.id };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Error desconocido';

      this.logger.error('Extraccion de PDF fallida', error);

      await this.repository.create({
        typeId,
        companyId,
        performedBy: userId,
        prompt: extractionPrompt,
        result: null,
        model: 'unknown',
        status: 'error',
        errorMessage,
      });

      throw new BadRequestException(
        `La extraccion del PDF fallo: ${errorMessage}`,
      );
    }
  }

  /**
   * Extracción IA genérica de un DOCUMENTO del estudio de capacidad de pago
   * (extracto bancario, desprendible de nómina o factura de contratista). A
   * diferencia de extractPdf (EEFF):
   *  - NO guarda el PDF en la fila de AiAnalysis (el binario ya vive en
   *    Supabase Storage vía StudyDocument; 6+ extractos en bytea no escalan).
   *  - No interpreta el shape: devuelve el JSON parseado tal cual + las
   *    extractionFlags; la normalización y validación son del llamador.
   * La corrida (tokens/costo/prompt) sí queda en AiAnalysis, ligada al estudio.
   */
  async extractStudyDocument(params: {
    pdfBuffer: Buffer;
    prompt: string;
    /** Code del Parameter ai_analysis_type (p. ej. bankStatementPdfExtraction). */
    typeCode: string;
    /** Perfil de extracción (modelo + presupuesto) según el tipo de documento. */
    extractionKind: ExtractionKind;
    companyId: string;
    userId: string;
    creditStudyId: string;
    customerId: string;
  }): Promise<{
    parsed: Record<string, unknown>;
    extractionFlags: ReliabilityFlag[];
    aiAnalysisId: string;
    usage: AiRunUsage;
  }> {
    const typeId = await this.getTypeId(params.typeCode);

    try {
      const aiResult = await this.aiService.extractFromPdf(
        params.pdfBuffer,
        params.prompt,
        params.extractionKind,
      );
      const estimatedCostUsd = this.aiService.estimateCostUsd(
        aiResult.model,
        aiResult.promptTokens,
        aiResult.completionTokens,
      );

      const parsed = this.parseAiJson(aiResult);
      const extractionFlags: ReliabilityFlag[] = Array.isArray(
        parsed.extractionFlags,
      )
        ? (parsed.extractionFlags as ReliabilityFlag[])
        : [];
      delete parsed.extractionFlags;

      const row = await this.repository.create({
        typeId,
        companyId: params.companyId,
        creditStudyId: params.creditStudyId,
        customerId: params.customerId,
        performedBy: params.userId,
        prompt: params.prompt,
        // Sin pdfFile: el binario vive en Storage (StudyDocument.storagePath).
        result: aiResult.content,
        model: aiResult.model,
        promptTokens: aiResult.promptTokens,
        completionTokens: aiResult.completionTokens,
        totalTokens: aiResult.totalTokens,
        estimatedCostUsd,
        durationMs: aiResult.durationMs,
        status: 'success',
      });

      return {
        parsed,
        extractionFlags,
        aiAnalysisId: row.id,
        usage: {
          model: aiResult.model,
          promptTokens: aiResult.promptTokens,
          completionTokens: aiResult.completionTokens,
          totalTokens: aiResult.totalTokens,
          estimatedCostUsd,
          durationMs: aiResult.durationMs,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Error desconocido';
      this.logger.error('Extraccion de documento del estudio fallida', error);

      await this.repository.create({
        typeId,
        companyId: params.companyId,
        creditStudyId: params.creditStudyId,
        customerId: params.customerId,
        performedBy: params.userId,
        prompt: params.prompt,
        result: null,
        model: 'unknown',
        status: 'error',
        errorMessage,
      });

      throw new BadRequestException(
        `La extraccion del documento fallo: ${errorMessage}`,
      );
    }
  }

  /**
   * CLASIFICACIÓN CONSOLIDADA de movimientos del estudio de capacidad: una
   * sola llamada con todos los meses para que un único criterio decida qué es
   * ingreso, traslado propio o gasto (la extracción por PDF deja solo un
   * borrador). No lanza BadRequest: si falla, registra la corrida en error y
   * relanza el Error crudo — el llamador decide el fallback (usar el borrador),
   * porque el estudio debe poder realizarse aunque esta pasada se caiga.
   */
  async classifyStudyMovements(params: {
    systemPrompt: string;
    userMessage: string;
    companyId: string;
    userId: string;
    creditStudyId: string;
    customerId: string;
  }): Promise<{ parsed: Record<string, unknown>; usage: AiRunUsage }> {
    const typeId = await this.getTypeId('movementClassification');

    try {
      const aiResult = await this.aiService.classifyMovements(
        params.systemPrompt,
        params.userMessage,
      );
      const estimatedCostUsd = this.aiService.estimateCostUsd(
        aiResult.model,
        aiResult.promptTokens,
        aiResult.completionTokens,
      );
      const parsed = this.parseAiJson(aiResult);

      await this.repository.create({
        typeId,
        companyId: params.companyId,
        creditStudyId: params.creditStudyId,
        customerId: params.customerId,
        performedBy: params.userId,
        // Solo el system prompt: el userMessage son los movimientos completos
        // (pesados y con datos del titular) que ya viven en StudyDocument.
        prompt: params.systemPrompt,
        result: aiResult.content,
        model: aiResult.model,
        promptTokens: aiResult.promptTokens,
        completionTokens: aiResult.completionTokens,
        totalTokens: aiResult.totalTokens,
        estimatedCostUsd,
        durationMs: aiResult.durationMs,
        status: 'success',
      });

      return {
        parsed,
        usage: {
          model: aiResult.model,
          promptTokens: aiResult.promptTokens,
          completionTokens: aiResult.completionTokens,
          totalTokens: aiResult.totalTokens,
          estimatedCostUsd,
          durationMs: aiResult.durationMs,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Error desconocido';
      this.logger.error(
        'Clasificación consolidada de movimientos fallida',
        error,
      );

      await this.repository.create({
        typeId,
        companyId: params.companyId,
        creditStudyId: params.creditStudyId,
        customerId: params.customerId,
        performedBy: params.userId,
        prompt: params.systemPrompt,
        result: null,
        model: 'unknown',
        status: 'error',
        errorMessage,
      });

      throw error instanceof Error ? error : new Error(errorMessage);
    }
  }

  /**
   * Corre la MISMA extracción IA sobre un PDF pero SIN persistir nada: ni la
   * fila de AiAnalysis, ni el PDF, ni períodos. Es la herramienta de prueba del
   * portal admin (afinar el prompt / verificar cómo lee un documento) y por eso
   * no exige empresa ni cliente, que en el portal no existen. Devuelve además
   * las métricas de la corrida (tokens y costo) y el texto crudo del modelo.
   */
  async extractPdfDryRun(pdfBuffer: Buffer): Promise<ExtractPdfDryRunResult> {
    const extractionPrompt = buildFinancialPdfExtractionPrompt(new Date());

    try {
      const { aiResult, financialData, reliabilityFlags, estimatedCostUsd } =
        await this.runPdfExtraction(pdfBuffer, extractionPrompt);

      return {
        financialData,
        reliabilityFlags,
        rawContent: aiResult.content,
        usage: {
          model: aiResult.model,
          promptTokens: aiResult.promptTokens,
          completionTokens: aiResult.completionTokens,
          totalTokens: aiResult.totalTokens,
          estimatedCostUsd,
          durationMs: aiResult.durationMs,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Error desconocido';
      this.logger.error('Extraccion de PDF (prueba admin) fallida', error);
      throw new BadRequestException(
        `La extraccion del PDF fallo: ${errorMessage}`,
      );
    }
  }

  /**
   * Llamada a la IA + parseo del JSON de la extracción. Núcleo compartido por el
   * flujo real (extractPdf, que persiste) y la prueba del portal admin
   * (extractPdfDryRun): ambos leen el PDF exactamente igual.
   */
  private async runPdfExtraction(pdfBuffer: Buffer, extractionPrompt: string) {
    const aiResult = await this.aiService.extractFromPdf(
      pdfBuffer,
      extractionPrompt,
      'financialStatements',
    );

    const estimatedCostUsd = this.aiService.estimateCostUsd(
      aiResult.model,
      aiResult.promptTokens,
      aiResult.completionTokens,
    );

    const parsed = this.parseAiJson(aiResult) as ExtractPdfResponse;

    // The prompt returns { financialData, reliabilityFlags }. Fall back to the
    // old flat shape (financial fields at the top level) for resilience.
    const financialData: Record<string, unknown> =
      parsed.financialData ?? (parsed as Record<string, unknown>);
    const reliabilityFlags: ReliabilityFlag[] = Array.isArray(
      parsed.reliabilityFlags,
    )
      ? parsed.reliabilityFlags
      : [];

    // Replace null values with 0 (except balanceSheetDate which is a date string)
    for (const key of Object.keys(financialData)) {
      if (financialData[key] === null && key !== 'balanceSheetDate') {
        financialData[key] = 0;
      }
    }

    return { aiResult, financialData, reliabilityFlags, estimatedCostUsd };
  }

  /**
   * Parsea la respuesta JSON de una extracción. El modelo suele envolverla en
   * un bloque ```json; si además se quedó sin presupuesto de salida, el bloque
   * NUNCA cierra y el JSON llega a medias — de ahí que primero se declare el
   * truncamiento (mensaje accionable) en vez de dejar reventar a JSON.parse
   * con un "Unexpected token" que no le dice nada a nadie.
   */
  private parseAiJson(aiResult: AiCompletionResult): Record<string, unknown> {
    if (aiResult.truncated) {
      throw new Error(
        'El documento es demasiado extenso para procesarlo en una sola lectura y la respuesta quedó incompleta. ' +
          'Carga el documento por períodos más cortos (por ejemplo, un extracto por mes) o aumenta AI_MAX_TOKENS_EXTRACTION.',
      );
    }

    let raw = (aiResult.content || '').trim();
    if (!raw) {
      throw new Error('El modelo no devolvió contenido para el documento.');
    }

    // Bloque de código cerrado; si no cierra, se quita solo la apertura.
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    raw = fenced
      ? fenced[1].trim()
      : raw.replace(/^```(?:json)?\s*/i, '').trim();

    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // Último recurso: recortar a lo que va del primer { al último }, por si
      // el modelo antepuso o añadió prosa al JSON.
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start !== -1 && end > start) {
        try {
          return JSON.parse(raw.slice(start, end + 1)) as Record<
            string,
            unknown
          >;
        } catch {
          /* cae al error de abajo */
        }
      }
      throw new Error(
        'La respuesta del modelo no es un JSON válido (probablemente quedó incompleta). Intenta de nuevo o carga el documento por períodos más cortos.',
      );
    }
  }

  async getPdf(id: string, companyId: string) {
    const analysis = await this.repository.findByIdWithPdf(id, companyId);
    if (!analysis) {
      throw new NotFoundException(
        `Analisis IA con id=${id} no encontrado en esta empresa`,
      );
    }
    if (!analysis.pdfFile) {
      throw new NotFoundException(
        'No hay archivo PDF almacenado para este analisis',
      );
    }
    return analysis.pdfFile;
  }

  /**
   * Compatibilidad de keyFigures: los resultados congelados ANTES del cambio a
   * "pago único al vencimiento" traen estimatedMonthlyQuota y no las cifras
   * nuevas — se derivan aquí (pago = cupo solicitado; capacidad acumulada =
   * capacidad mensual × meses del plazo) para que el prompt siempre las tenga.
   */
  private normalizeKeyFigures(
    kf: ScoringResultShape['keyFigures'],
    study: { requestedTerm: number | null; requestedCreditLine: number | null },
  ): CreditStudyPromptInput['keyFigures'] {
    if (!kf) return undefined;
    const term = study.requestedTerm ?? 0;
    const months = term > 0 ? term / 30 : 1;
    return {
      ...kf,
      paymentAtMaturity:
        kf.paymentAtMaturity ?? Math.round(study.requestedCreditLine ?? 0),
      capacityInTerm:
        kf.capacityInTerm ?? Math.round(kf.monthlyPaymentCapacity * months),
    };
  }

  /**
   * ¿El vector de comportamiento de pago de la central muestra mora? Mora = algún
   * mes con código distinto de 'N' (al día) y de '-'/' ' (sin información). Misma
   * regla que credit-studies (catálogo PAYMENT_BEHAVIOR).
   */
  private detectArrears(paymentBehavior: unknown): boolean {
    if (!Array.isArray(paymentBehavior)) return false;
    const items = paymentBehavior as Array<{ comportamiento?: unknown }>;
    return items.some((item) => {
      const raw = item?.comportamiento;
      const code = (typeof raw === 'string' ? raw : '').trim().toUpperCase();
      return code !== '' && code !== 'N' && code !== '-';
    });
  }

  async findAll(companyId: string, filters: FilterAiAnalysisDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const skip = (page - 1) * limit;

    const where: Prisma.AiAnalysisWhereInput = { companyId };

    if (filters.customerId) {
      where.customerId = filters.customerId;
    }

    if (filters.creditStudyId) {
      where.creditStudyId = filters.creditStudyId;
    }

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.typeId) {
      where.typeId = filters.typeId;
    }

    if (filters.search) {
      where.customer = {
        OR: [
          { businessName: { contains: filters.search, mode: 'insensitive' } },
          {
            identificationNumber: {
              contains: filters.search,
              mode: 'insensitive',
            },
          },
        ],
      };
    }

    const { data, total } = await this.repository.findAll({
      skip,
      take: limit,
      where,
      orderBy: { createdAt: 'desc' },
    });

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findById(id: string, companyId: string) {
    const analysis = await this.repository.findById(id, companyId);
    if (!analysis) {
      throw new NotFoundException(
        `Analisis IA con id=${id} no encontrado en esta empresa`,
      );
    }
    return analysis;
  }
}
