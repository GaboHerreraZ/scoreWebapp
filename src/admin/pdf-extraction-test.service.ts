import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { AiAnalysesService } from '../ai-analyses/ai-analyses.service.js';
import { ParametersRepository } from '../parameters/parameters.repository.js';
import { PdfExtractionTestRepository } from './pdf-extraction-test.repository.js';
import { computeFinancialIndicators } from '../financial-statements/utils/financial-indicators.js';
import {
  normalizeExtractedPeriod,
  toIndicatorFigures,
  type ExtractedFinancialData,
  type NormalizedPeriod,
} from '../financial-statements/utils/extracted-periods.js';
import { getMonthsFromPeriod } from '../common/enums/income-statement-period.enum.js';
import { TestExtractPdfDto } from './dto/test-extract-pdf.dto.js';
import { FilterPdfExtractionTestDto } from './dto/filter-pdf-extraction-test.dto.js';
import { Prisma } from '../../generated/prisma/client.js';

/**
 * Banco de pruebas de la extracción de PDF para el portal admin.
 *
 * Corre EXACTAMENTE la misma cadena que el flujo real de un estudio
 * (FinancialStatementsService.extractPdfForStudy): extracción IA → normalización
 * de períodos → cálculo de indicadores y ratios. La diferencia es que NO toca
 * los datos del negocio: no crea AiAnalysis, ni períodos, ni análisis
 * financieros, no avanza ningún estudio y no consume bolsa de ningún cliente.
 *
 * Lo único que persiste es el RESULTADO de la corrida (tabla
 * pdf_extraction_tests, JSONB + nombre del archivo), para poder volver a
 * revisarlo sin re-subir el PDF ni pagar otra corrida de IA.
 */
@Injectable()
export class PdfExtractionTestService {
  constructor(
    private readonly aiAnalysesService: AiAnalysesService,
    private readonly parametersRepository: ParametersRepository,
    private readonly repository: PdfExtractionTestRepository,
  ) {}

  async testExtraction(
    file: Express.Multer.File,
    dto: TestExtractPdfDto,
    adminUserId: string,
  ) {
    // 1. La IA lee el PDF (mismo prompt del flujo real). La corrida NO queda
    //    registrada en ai_analyses ni se guarda el PDF.
    const extraction = await this.aiAnalysesService.extractPdfDryRun(
      file.buffer,
    );
    const data = extraction.financialData as unknown as ExtractedFinancialData;

    // 2. Período del estado de resultados (mensual/anual) → anualización.
    const periodLabel = await this.resolvePeriodLabel(dto.incomeStatementId);

    // 3. Un período por cada año que trajo la IA, ordenados por año DESC: el más
    //    reciente es el corriente.
    const rawPeriods = Array.isArray(data.periods) ? data.periods : [];
    if (rawPeriods.length === 0) {
      throw new BadRequestException(
        'La extracción no devolvió ningún período financiero del PDF.',
      );
    }

    const periods = rawPeriods
      .map((p) => normalizeExtractedPeriod(p, dto.fiscalYear))
      .sort((a, b) => b.fiscalYear - a.fiscalYear);

    // 4. Indicadores y ratios: dependen de los 2 períodos MÁS RECIENTES
    //    (corriente + anterior), igual que en el flujo real.
    const { ratios, ...indicators } = computeFinancialIndicators(
      toIndicatorFigures(periods[0], periods[1]),
      periodLabel,
    );

    const response = {
      period: {
        incomeStatementId: dto.incomeStatementId ?? null,
        label: periodLabel,
        months: getMonthsFromPeriod(periodLabel),
      },
      periods: periods.map((p) => this.presentPeriod(p)),
      // Se calculan sobre periods[0] (corriente) y periods[1] (anterior).
      indicators,
      ratios,
      reliabilityFlags: extraction.reliabilityFlags,
      usage: extraction.usage,
    };

    // 5. Archivar la corrida. El texto crudo se guarda SIEMPRE (aunque el
    //    request no lo haya pedido): es justo lo que se quiere revisar después
    //    sin re-correr la extracción.
    const saved = await this.repository.create({
      fileName: file.originalname,
      fileSizeBytes: file.size,
      incomeStatementId: dto.incomeStatementId ?? null,
      fiscalYear: dto.fiscalYear ?? null,
      response: response as unknown as Prisma.InputJsonValue,
      rawContent: extraction.rawContent,
      model: extraction.usage.model,
      promptTokens: extraction.usage.promptTokens,
      completionTokens: extraction.usage.completionTokens,
      totalTokens: extraction.usage.totalTokens,
      estimatedCostUsd: extraction.usage.estimatedCostUsd,
      durationMs: extraction.usage.durationMs,
      periodsCount: periods.length,
      flagsCount: extraction.reliabilityFlags.length,
      performedBy: adminUserId,
    });

    return {
      id: saved.id,
      fileName: saved.fileName,
      createdAt: saved.createdAt,
      ...response,
      ...(dto.includeRaw ? { raw: extraction.rawContent } : {}),
    };
  }

  /**
   * Corridas archivadas, de la más reciente a la más antigua. Sin el JSONB ni el
   * texto crudo: la fila trae solo lo necesario para elegir cuál abrir.
   * `search` filtra por nombre de archivo (contiene, sin distinguir mayúsculas).
   */
  async findAll(filters: FilterPdfExtractionTestDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;

    const { data, total } = await this.repository.findAll({
      skip: (page - 1) * limit,
      take: limit,
      search: filters.search,
    });

    const admins = await this.repository.platformAdminsByUserId(
      data.map((t) => t.performedBy),
    );

    return {
      data: data.map(({ performedBy, ...test }) => ({
        ...test,
        performedBy: admins.get(performedBy) ?? {
          userId: performedBy,
          name: null,
        },
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Corrida archivada completa: el response tal cual se devolvió el día que se
   * corrió (períodos, indicadores, ratios, red flags y consumo) más el texto
   * crudo del modelo.
   */
  async findById(id: string) {
    const test = await this.repository.findById(id);
    if (!test) {
      throw new NotFoundException(
        `Prueba de extracción con id=${id} no encontrada`,
      );
    }

    const admins = await this.repository.platformAdminsByUserId([
      test.performedBy,
    ]);

    return {
      id: test.id,
      fileName: test.fileName,
      fileSizeBytes: test.fileSizeBytes,
      createdAt: test.createdAt,
      performedBy: admins.get(test.performedBy) ?? {
        userId: test.performedBy,
        name: null,
      },
      periodsCount: test.periodsCount,
      flagsCount: test.flagsCount,
      // El response se devuelve sin transformar: es el archivo de la corrida.
      ...(test.response as object),
      raw: test.rawContent,
    };
  }

  /** Borra una corrida archivada (limpieza del banco de pruebas). */
  async remove(id: string) {
    const test = await this.repository.findById(id);
    if (!test) {
      throw new NotFoundException(
        `Prueba de extracción con id=${id} no encontrada`,
      );
    }
    await this.repository.delete(id);
    return { success: true, id };
  }

  /** Label del Parameter income_statement (p.ej. '12' = anual). */
  private async resolvePeriodLabel(
    incomeStatementId?: number | null,
  ): Promise<string> {
    if (!incomeStatementId) return '12';
    const param = await this.parametersRepository.findById(incomeStatementId);
    return param?.label ?? '12';
  }

  /** La fecha de balance se serializa como YYYY-MM-DD (sin hora). */
  private presentPeriod({ balanceSheetDate, ...period }: NormalizedPeriod) {
    return {
      ...period,
      balanceSheetDate: balanceSheetDate
        ? balanceSheetDate.toISOString().slice(0, 10)
        : null,
    };
  }
}
