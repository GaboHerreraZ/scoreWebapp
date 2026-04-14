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
  CREDIT_STUDY_SYSTEM_PROMPT,
  buildCreditStudyUserMessage,
  FINANCIAL_PDF_EXTRACTION_PROMPT,
} from '../ai/prompts/credit-study-analysis.prompt.js';
import { FilterAiAnalysisDto } from './dto/filter-ai-analysis.dto.js';
import { Prisma } from '../../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';

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

  async analyze(creditStudyId: string, companyId: string, userId: string) {
    // 1. Get analysis type parameter
    const typeId = await this.getTypeId('creditReview');

    // 2. Validate credit study exists and belongs to company
    const study = await this.repository.findCreditStudyWithCustomer(
      creditStudyId,
      companyId,
    );
    if (!study) {
      throw new NotFoundException(
        `Estudio de credito con id=${creditStudyId} no encontrado en esta empresa`,
      );
    }

    // 3. Validate study has been performed (has viability data)
    if (
      !study.viabilityScore ||
      !study.viabilityStatus ||
      !study.viabilityConditions
    ) {
      throw new BadRequestException(
        'El estudio de credito debe ser realizado antes de ejecutar el analisis con IA. Ejecute primero el endpoint de realizar estudio.',
      );
    }

    // 4. Check subscription AI analysis limits
    const companySub = await this.repository.findCurrentSubscription(companyId);
    if (!companySub) {
      throw new BadRequestException(
        'La empresa no tiene una suscripcion activa',
      );
    }

    const maxAnalyses = companySub.subscription.maxAiAnalysisPerMonth;
    if (maxAnalyses != null && maxAnalyses > 0) {
      const usageThisMonth = await this.repository.countThisMonthByType(
        companyId,
        typeId,
      );
      if (usageThisMonth >= maxAnalyses) {
        throw new BadRequestException(
          `Limite de analisis IA alcanzado para este mes (${maxAnalyses}). Actualice su suscripcion para obtener mas analisis.`,
        );
      }
    }

    // 5. Build the prompt
    const customer = study.customer;
    const viabilityConditions = study.viabilityConditions as {
      dimensions: Record<
        string,
        { score: number; maxScore: number; status: string; label: string }
      >;
      alerts: Array<{ type: string; dimension: string; message: string }>;
      summary: { totalScore: number; maxScore: number; status: string };
    };

    const userMessage = buildCreditStudyUserMessage({
      customerName: customer.businessName,
      customerCity: customer.city ?? 'No especificada',
      seniority: customer.seniority ?? 0,
      requestedTerm: study.requestedTerm ?? 0,
      requestedCreditLine: study.requestedCreditLine ?? 0,
      viabilityScore: study.viabilityScore,
      viabilityStatus: study.viabilityStatus,
      recommendedTerm: study.recommendedTerm ?? 0,
      recommendedCreditLine: study.recommendedCreditLine ?? 0,
      monthlyPaymentCapacity: study.monthlyPaymentCapacity ?? 0,
      annualPaymentCapacity: study.annualPaymentCapacity ?? 0,
      ebitda: study.ebitda ?? 0,
      currentDebtService: study.currentDebtService ?? 0,
      totalAssets: study.totalAssets ?? 0,
      totalLiabilities: study.totalLiabilities ?? 0,
      equity: study.equity ?? 0,
      ordinaryActivityRevenue: study.ordinaryActivityRevenue ?? 0,
      grossProfit: study.grossProfit ?? 0,
      netIncome: study.netIncome ?? 0,
      accountsReceivableTurnover: study.accountsReceivableTurnover ?? 0,
      paymentTimeSuppliers: study.paymentTimeSuppliers ?? 0,
      viabilityConditions,
    });

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

  async extractPdf(pdfBuffer: Buffer, companyId: string, userId: string) {
    // 1. Get extraction type parameter
    const typeId = await this.getTypeId('financialStatementsPdfUpload');

    // 2. Check subscription PDF extraction limits
    const companySub = await this.repository.findCurrentSubscription(companyId);
    if (!companySub) {
      throw new BadRequestException(
        'La empresa no tiene una suscripcion activa',
      );
    }

    const maxExtractions = companySub.subscription.maxPdfExtractionsPerMonth;

    if (maxExtractions == null || maxExtractions <= 0) {
      throw new BadRequestException(
        'Su plan de suscripcion no incluye extraccion de PDF. Actualice su plan para usar esta funcionalidad.',
      );
    }

    const usageThisMonth = await this.repository.countThisMonthByType(
      companyId,
      typeId,
    );
    if (usageThisMonth >= maxExtractions) {
      throw new BadRequestException(
        `Limite de extracciones PDF alcanzado para este mes (${maxExtractions}). Actualice su suscripcion para obtener mas extracciones.`,
      );
    }

    // 3. Call Claude AI to extract data from PDF
    try {
      const aiResult = await this.aiService.extractFromPdf(
        pdfBuffer,
        FINANCIAL_PDF_EXTRACTION_PROMPT,
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
      const parsedData = JSON.parse(rawContent);

      // Replace null values with 0 (except balanceSheetDate which is a date string)
      for (const key of Object.keys(parsedData)) {
        if (parsedData[key] === null && key !== 'balanceSheetDate') {
          parsedData[key] = 0;
        }
      }

      // 4. Save the extraction record with the PDF file
      await this.repository.create({
        typeId,
        companyId,
        performedBy: userId,
        prompt: FINANCIAL_PDF_EXTRACTION_PROMPT,
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

      return parsedData;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Error desconocido';

      this.logger.error('Extraccion de PDF fallida', error);

      await this.repository.create({
        typeId,
        companyId,
        performedBy: userId,
        prompt: FINANCIAL_PDF_EXTRACTION_PROMPT,
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

  async getUsage(companyId: string) {
    const companySub = await this.repository.findCurrentSubscription(companyId);

    const maxAnalyses = companySub?.subscription.maxAiAnalysisPerMonth ?? null;
    const maxExtractions =
      companySub?.subscription.maxPdfExtractionsPerMonth ?? null;

    // Get type IDs for counting per type
    const [analysisType, extractionType] = await Promise.all([
      this.parametersRepository.findByCode('creditReview'),
      this.parametersRepository.findByCode('financialStatementsPdfUpload'),
    ]);

    const [analysisUsage, extractionUsage] = await Promise.all([
      analysisType
        ? this.repository.countThisMonthByType(companyId, analysisType.id)
        : Promise.resolve(0),
      extractionType
        ? this.repository.countThisMonthByType(companyId, extractionType.id)
        : Promise.resolve(0),
    ]);

    return {
      aiAnalysis: {
        usedThisMonth: analysisUsage,
        maxPerMonth: maxAnalyses,
        remaining:
          maxAnalyses != null ? Math.max(0, maxAnalyses - analysisUsage) : null,
      },
      pdfExtraction: {
        usedThisMonth: extractionUsage,
        maxPerMonth: maxExtractions,
        remaining:
          maxExtractions != null
            ? Math.max(0, maxExtractions - extractionUsage)
            : null,
      },
    };
  }
}
