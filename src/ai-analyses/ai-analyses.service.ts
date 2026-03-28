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
        `Parameter with code="${code}" not found. Please create it in the parameters table.`,
      );
    }
    return param.id;
  }

  async analyze(creditStudyId: string, companyId: string, userId: string) {
    // 1. Get analysis type parameter
    const typeId = await this.getTypeId('estudioCredito');

    // 2. Validate credit study exists and belongs to company
    const study = await this.repository.findCreditStudyWithCustomer(
      creditStudyId,
      companyId,
    );
    if (!study) {
      throw new NotFoundException(
        `Credit study with id=${creditStudyId} not found in this company`,
      );
    }

    // 3. Validate study has been performed (has viability data)
    if (!study.viabilityScore || !study.viabilityStatus || !study.viabilityConditions) {
      throw new BadRequestException(
        'Credit study must be performed before running AI analysis. Execute the perform endpoint first.',
      );
    }

    // 4. Check subscription AI analysis limits
    const companySub = await this.repository.findCurrentSubscription(companyId);
    if (!companySub) {
      throw new BadRequestException(
        'Company does not have an active subscription',
      );
    }

    const maxAnalyses = companySub.subscription.maxAiAnalysisPerMonth;
    if (maxAnalyses != null && maxAnalyses > 0) {
      const usageThisMonth = await this.repository.countThisMonthByType(companyId, typeId);
      if (usageThisMonth >= maxAnalyses) {
        throw new BadRequestException(
          `AI analysis limit reached for this month (${maxAnalyses}). Upgrade your subscription for more analyses.`,
        );
      }
    }

    // 5. Build the prompt
    const customer = study.customer;
    const viabilityConditions = study.viabilityConditions as {
      dimensions: Record<string, { score: number; maxScore: number; status: string; label: string }>;
      alerts: Array<{ type: string; dimension: string; message: string }>;
      summary: { totalScore: number; maxScore: number; status: string };
    };

    const userMessage = buildCreditStudyUserMessage({
      customerName: customer.businessName,
      customerCity: customer.city ?? 'No especificada',
      seniority: customer.seniority ?? 0,
      requestedTerm: study.requestedTerm ?? 0,
      requestedMonthlyCreditLine: study.requestedMonthlyCreditLine ?? 0,
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
      return this.repository.create({
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
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        `AI analysis failed for credit study ${creditStudyId}`,
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

      throw new BadRequestException(
        `AI analysis failed: ${errorMessage}`,
      );
    }
  }

  async extractPdf(pdfBuffer: Buffer, companyId: string, userId: string) {
    // 1. Get extraction type parameter
    const typeId = await this.getTypeId('cargaPdfEstadosFinancieros');

    // 2. Check subscription PDF extraction limits
    const companySub = await this.repository.findCurrentSubscription(companyId);
    if (!companySub) {
      throw new BadRequestException(
        'Company does not have an active subscription',
      );
    }

    const maxExtractions = companySub.subscription.maxPdfExtractionsPerMonth;
    if (maxExtractions != null && maxExtractions > 0) {
      const usageThisMonth = await this.repository.countThisMonthByType(companyId, typeId);
      if (usageThisMonth >= maxExtractions) {
        throw new BadRequestException(
          `PDF extraction limit reached for this month (${maxExtractions}). Upgrade your subscription for more extractions.`,
        );
      }
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

      return parsedData;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.error('PDF extraction failed', error);

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
        `PDF extraction failed: ${errorMessage}`,
      );
    }
  }

  async getPdf(id: string, companyId: string) {
    const analysis = await this.repository.findByIdWithPdf(id, companyId);
    if (!analysis) {
      throw new NotFoundException(
        `AI analysis with id=${id} not found in this company`,
      );
    }
    if (!analysis.pdfFile) {
      throw new NotFoundException(
        `No PDF file stored for this analysis`,
      );
    }
    return analysis.pdfFile;
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
        `AI analysis with id=${id} not found in this company`,
      );
    }
    return analysis;
  }

  async getUsage(companyId: string) {
    const companySub = await this.repository.findCurrentSubscription(companyId);

    const maxAnalyses = companySub?.subscription.maxAiAnalysisPerMonth ?? null;
    const maxExtractions = companySub?.subscription.maxPdfExtractionsPerMonth ?? null;

    // Get type IDs for counting per type
    const [analysisType, extractionType] = await Promise.all([
      this.parametersRepository.findByCode('estudioCredito'),
      this.parametersRepository.findByCode('cargaPdfEstadosFinancieros'),
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
        remaining: maxAnalyses != null ? Math.max(0, maxAnalyses - analysisUsage) : null,
      },
      pdfExtraction: {
        usedThisMonth: extractionUsage,
        maxPerMonth: maxExtractions,
        remaining: maxExtractions != null ? Math.max(0, maxExtractions - extractionUsage) : null,
      },
    };
  }
}
