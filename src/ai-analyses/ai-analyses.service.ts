import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { AiAnalysesRepository } from './ai-analyses.repository.js';
import { AiService } from '../ai/ai.service.js';
import { ParametersRepository } from '../parameters/parameters.repository.js';
import {
  buildFinancialPdfExtractionPrompt,
  CREDIT_STUDY_SYSTEM_PROMPT,
  buildCreditStudyUserMessage,
  type CreditStudyPromptInput,
  type PromptFinancialSource,
} from '../ai/prompts/credit-study-analysis.prompt.js';
import { scoreToBand } from '../scoring/scoring.constants.js';
import { FilterAiAnalysisDto } from './dto/filter-ai-analysis.dto.js';
import { Prisma } from '../../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';

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
    estimatedMonthlyQuota: number;
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
}

@Injectable()
export class AiAnalysesService {
  private readonly logger = new Logger(AiAnalysesService.name);

  constructor(
    private readonly repository: AiAnalysesRepository,
    private readonly aiService: AiService,
    private readonly parametersRepository: ParametersRepository,
    private readonly notificationsService: NotificationsService,
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
    const { study, analyses, riskSnapshot } = inputs;
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
      customerCity: customer.city ?? 'No especificada',
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
      keyFigures: result.keyFigures,
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
    const fullPrompt = `[SYSTEM]\n${CREDIT_STUDY_SYSTEM_PROMPT}\n\n[USER]\n${userMessage}`;

    // 6. Call Claude AI
    try {
      const aiResult = await this.aiService.generateCompletion(
        CREDIT_STUDY_SYSTEM_PROMPT,
        userMessage,
      );

      const estimatedCostUsd = this.aiService.estimateCostUsd(
        aiResult.model,
        aiResult.promptTokens,
        aiResult.completionTokens,
      );

      // 7. Save the analysis record
      const analysis = await this.repository.create({
        typeId,
        companyId,
        customerId: study.customerId,
        creditStudyId,
        performedBy: userId,
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

      // 8. Emit notification
      this.emitNotification(
        userId,
        companyId,
        'Análisis IA completado',
        `El análisis IA del estudio de crédito de ${customer.businessName} fue completado exitosamente.`,
        `/app/credit-study/detail/${creditStudyId}`,
        'ai_analysis',
      );

      return analysis;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Error desconocido';

      this.logger.error(
        `Analisis IA fallido para estudio de credito ${creditStudyId}`,
        error,
      );

      await this.repository.create({
        typeId,
        companyId,
        customerId: study.customerId,
        creditStudyId,
        performedBy: userId,
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
      const aiResult = await this.aiService.extractFromPdf(
        pdfBuffer,
        extractionPrompt,
      );

      const estimatedCostUsd = this.aiService.estimateCostUsd(
        aiResult.model,
        aiResult.promptTokens,
        aiResult.completionTokens,
      );

      let rawContent = aiResult.content || '{}';
      // Claude may wrap JSON in ```json ... ``` blocks — strip them
      const jsonBlockMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonBlockMatch) {
        rawContent = jsonBlockMatch[1].trim();
      }
      const parsed = JSON.parse(rawContent) as ExtractPdfResponse;

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

      // 5. Emit notification
      this.emitNotification(
        userId,
        companyId,
        'Extracción PDF completada',
        'Se extrajeron los datos financieros del PDF exitosamente.',
        `/app/credit-study`,
        'ai_analysis',
      );

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

  private emitNotification(
    userId: string,
    companyId: string,
    title: string,
    message: string,
    route: string,
    notificationTypeCode: string,
  ): void {
    this.parametersRepository
      .findByTypeAndCode('notification_type', notificationTypeCode)
      .then((type) => {
        if (!type) return;
        return this.notificationsService.create(userId, {
          companyId,
          typeId: type.id,
          title,
          message,
          route,
        });
      })
      .catch(() => {});
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
