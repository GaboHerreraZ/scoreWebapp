import { Injectable, BadRequestException } from '@nestjs/common';
import { AiAnalysesService } from '../ai-analyses/ai-analyses.service.js';
import { ParametersRepository } from '../parameters/parameters.repository.js';
import { computeFinancialIndicators } from '../financial-statements/utils/financial-indicators.js';
import {
  normalizeExtractedPeriod,
  toIndicatorFigures,
  type ExtractedFinancialData,
  type NormalizedPeriod,
} from '../financial-statements/utils/extracted-periods.js';
import { getMonthsFromPeriod } from '../common/enums/income-statement-period.enum.js';
import { TestExtractPdfDto } from './dto/test-extract-pdf.dto.js';

/**
 * Banco de pruebas de la extracción de PDF para el portal admin.
 *
 * Corre EXACTAMENTE la misma cadena que el flujo real de un estudio
 * (FinancialStatementsService.extractPdfForStudy): extracción IA → normalización
 * de períodos → cálculo de indicadores y ratios. La diferencia es que aquí NO se
 * persiste nada: ni la corrida de IA, ni el PDF, ni períodos, ni análisis. Sirve
 * para afinar el prompt y verificar cómo lee un documento sin ensuciar datos ni
 * consumir bolsa de ningún cliente.
 */
@Injectable()
export class PdfExtractionTestService {
  constructor(
    private readonly aiAnalysesService: AiAnalysesService,
    private readonly parametersRepository: ParametersRepository,
  ) {}

  async testExtraction(pdfBuffer: Buffer, dto: TestExtractPdfDto) {
    // 1. La IA lee el PDF (mismo prompt del flujo real) sin dejar rastro en BD.
    const extraction = await this.aiAnalysesService.extractPdfDryRun(pdfBuffer);
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

    return {
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
      ...(dto.includeRaw ? { raw: extraction.rawContent } : {}),
    };
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
