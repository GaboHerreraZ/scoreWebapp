import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { FinancialStatementsRepository } from './financial-statements.repository.js';
import { AiAnalysesService } from '../ai-analyses/ai-analyses.service.js';
import { ParametersRepository } from '../parameters/parameters.repository.js';
import {
  computeFinancialIndicators,
  type FinancialStatementRawFigures,
  type FinancialIndicators,
} from './utils/financial-indicators.js';
import { ExtractPdfDto } from './dto/extract-pdf.dto.js';
import {
  mapDataCreditoFinancials,
  type MappedFinancialPeriod,
} from '../credit-bureau/experian/experian.financials.mapper.js';
import { Prisma } from '../../generated/prisma/client.js';
import { toJson } from '../common/utils/prisma-json.util.js';

/** Cifras crudas de UN año que devuelve la IA (un objeto por período). */
interface ExtractedPeriod {
  fiscalYear?: number | null;
  balanceSheetDate?: string | null;

  cashAndEquivalents?: number | null;
  accountsReceivable?: number | null;
  inventories?: number | null;
  totalCurrentAssets?: number | null;
  fixedAssetsProperty?: number | null;
  totalNonCurrentAssets?: number | null;
  totalAssets?: number | null;
  shortTermFinancialLiabilities?: number | null;
  suppliers?: number | null;
  totalCurrentLiabilities?: number | null;
  longTermFinancialLiabilities?: number | null;
  totalNonCurrentLiabilities?: number | null;
  totalLiabilities?: number | null;
  retainedEarnings?: number | null;
  equity?: number | null;

  ordinaryActivityRevenue?: number | null;
  costOfSales?: number | null;
  grossProfit?: number | null;
  administrativeExpenses?: number | null;
  sellingExpenses?: number | null;
  depreciation?: number | null;
  amortization?: number | null;
  financialExpenses?: number | null;
  taxes?: number | null;
  netIncome?: number | null;
}

/** La IA devuelve un arreglo de períodos (uno por año del documento). */
interface ExtractedFinancialData {
  periods?: ExtractedPeriod[];
}

/** Campos monetarios que se copian tal cual de la IA al período de Prisma. */
const PERIOD_FIGURE_FIELDS = [
  'cashAndEquivalents',
  'accountsReceivable',
  'inventories',
  'totalCurrentAssets',
  'fixedAssetsProperty',
  'totalNonCurrentAssets',
  'totalAssets',
  'shortTermFinancialLiabilities',
  'suppliers',
  'totalCurrentLiabilities',
  'longTermFinancialLiabilities',
  'totalNonCurrentLiabilities',
  'totalLiabilities',
  'retainedEarnings',
  'equity',
  'ordinaryActivityRevenue',
  'costOfSales',
  'grossProfit',
  'administrativeExpenses',
  'sellingExpenses',
  'depreciation',
  'amortization',
  'financialExpenses',
  'taxes',
  'netIncome',
] as const;

@Injectable()
export class FinancialStatementsService {
  constructor(
    private readonly repository: FinancialStatementsRepository,
    private readonly aiAnalysesService: AiAnalysesService,
    private readonly parametersRepository: ParametersRepository,
  ) {}

  /**
   * Extrae los estados financieros de un PDF y los persiste para un estudio ya
   * existente. La IA lee el PDF (source='pdf_upload') y devuelve DOS años en un
   * objeto plano; se separan en dos FinancialStatementPeriod (corriente y
   * anterior), se derivan los indicadores del par y se guarda un FinancialAnalysis
   * congelado contra el estudio vía la join.
   */
  async extractPdfForStudy(
    pdfBuffer: Buffer,
    creditStudyId: string,
    companyId: string,
    userId: string,
    dto: ExtractPdfDto,
  ) {
    // 1. Validar que el estudio existe y pertenece a la empresa.
    const study = await this.repository.findCreditStudy(
      creditStudyId,
      companyId,
    );
    if (!study) {
      throw new NotFoundException(
        `Estudio de crédito con id=${creditStudyId} no encontrado en esta empresa`,
      );
    }

    // 2. La IA lee el PDF una sola vez: cifras (dos años) + red flags. El log de
    //    la corrida (tokens, costo, PDF binario) queda en la tabla AiAnalysis.
    const extraction = await this.aiAnalysesService.extractPdf(
      pdfBuffer,
      companyId,
      userId,
      { creditStudyId, customerId: study.customerId },
    );
    const data = extraction.financialData as unknown as ExtractedFinancialData;
    const reliabilityFlags = extraction.reliabilityFlags;

    // 3. Período del estado de resultados (mensual/anual) → anualización.
    const periodLabel = await this.resolvePeriodLabel(dto.incomeStatementId);

    // 4. Un FinancialStatementPeriod por cada año que trajo la IA. Se ordenan por
    //    año DESC: el más reciente es el corriente. Si un período no trae año, se
    //    infiere del balanceSheetDate o del fiscalYear del DTO (solo el 1º).
    const rawPeriods = Array.isArray(data.periods) ? data.periods : [];
    if (rawPeriods.length === 0) {
      throw new BadRequestException(
        'La extracción no devolvió ningún período financiero del PDF.',
      );
    }

    const periods = rawPeriods
      .map((p) => this.buildPeriod(p, companyId, study.customerId, userId, dto))
      .sort((a, b) => b.fiscalYear - a.fiscalYear);

    // 5. Indicadores: dependen de los 2 períodos MÁS RECIENTES (corriente +
    //    anterior). Se arma en memoria el par que espera el helper (*_1 / *_2);
    //    el algoritmo Altman del helper NO cambia.
    const indicators = computeFinancialIndicators(
      this.toIndicatorFigures(periods[0], periods[1]),
      periodLabel,
    );

    // 6. Persistir en una transacción: análisis + N períodos + join (congelación).
    const pdfAnalysis = await this.repository.persistAnalysis({
      companyId,
      customerId: study.customerId,
      createdBy: userId,
      creditStudyId,
      source: 'pdf_upload',
      periods,
      indicators: this.toAnalysisInput(indicators, reliabilityFlags),
    });

    // 7. Además del PDF, si el cliente tiene estados financieros en su última
    //    consulta a DataCrédito, se crea un segundo análisis (source='datacredito')
    //    con SUS cifras y ratios, congelado en el mismo estudio. Así el step2
    //    puede mostrar ambas fuentes en paralelo. Si no hay EEFF de DataCrédito,
    //    se sigue solo con el PDF (no falla).
    const datacreditoAnalysis = await this.buildDataCreditoAnalysis(
      study.customerId,
      companyId,
      creditStudyId,
      userId,
      periodLabel,
    );

    // 8. Avanzar el flujo: una vez cargados los EEFF, el estudio pasa de
    //    "Pendiente Estados Financieros" a "Pendiente Análisis de Estudio".
    //    Solo si venía de pendingFinancialStatements: si ya estaba más adelante
    //    (analizado/confirmado) y se re-cargó el PDF, NO se retrocede el estado.
    if (study.status?.code === 'pendingFinancialStatements') {
      const nextStatus = await this.parametersRepository.findByCode(
        'pendingStudyAnalysis',
      );
      if (nextStatus) {
        await this.repository.updateStudyStatus(creditStudyId, nextStatus.id);
      }
    }

    // Respuesta mínima: solo confirma que la lectura fue exitosa y qué fuentes
    // quedaron cargadas. El grueso (cifras, indicadores, ratios) lo sirve el
    // GET /credit-studies/:id/steps (step2), única fuente de verdad de la vista.
    return {
      success: true,
      sources: {
        pdf: { periods: pdfAnalysis.periods.length },
        datacredito: datacreditoAnalysis
          ? { periods: datacreditoAnalysis.periods.length }
          : null,
      },
    };
  }

  /**
   * Intenta construir el análisis financiero de DataCrédito a partir de la última
   * consulta al bureau del cliente. Mapea el bloque estadosFinancieros (2 años más
   * recientes), calcula los MISMOS indicadores/ratios que el PDF (comparabilidad)
   * y lo persiste congelado en el estudio. Devuelve null si no hay consulta o la
   * consulta no trajo estados financieros.
   */
  private async buildDataCreditoAnalysis(
    customerId: string,
    companyId: string,
    creditStudyId: string,
    userId: string,
    periodLabel: string,
  ) {
    const consultation =
      await this.repository.findLastConsultationRaw(customerId);
    if (!consultation) return null;

    const mapped = mapDataCreditoFinancials(consultation.rawResponse, 2);
    if (mapped.length === 0) return null;

    const periods = mapped.map((m) =>
      this.buildDataCreditoPeriod(
        m,
        companyId,
        customerId,
        userId,
        consultation.id,
      ),
    );

    const indicators = computeFinancialIndicators(
      this.toIndicatorFigures(periods[0], periods[1]),
      periodLabel,
    );

    return this.repository.persistAnalysis({
      companyId,
      customerId,
      createdBy: userId,
      creditStudyId,
      source: 'datacredito',
      periods,
      // DataCrédito no trae red flags (esas son de la extracción IA del PDF).
      indicators: this.toAnalysisInput(indicators, []),
    });
  }

  /**
   * Construye un FinancialStatementPeriod desde las cifras ya mapeadas de
   * DataCrédito (un año). Se ata a la consulta que lo originó (consultationId)
   * para trazar de qué llamada al bureau salieron esas cifras.
   */
  private buildDataCreditoPeriod(
    mapped: MappedFinancialPeriod,
    companyId: string,
    customerId: string,
    createdBy: string,
    consultationId: string,
  ): Prisma.FinancialStatementPeriodUncheckedCreateInput {
    const figures: Record<string, number | null | undefined> = {};
    for (const field of PERIOD_FIGURE_FIELDS) {
      figures[field] = mapped.figures[field] ?? null;
    }
    return {
      companyId,
      customerId,
      createdBy,
      source: 'datacredito',
      fiscalYear: mapped.fiscalYear,
      consultationId,
      ...figures,
    };
  }

  /**
   * Separa el resultado del helper en el shape que espera Prisma: los ratios de
   * presentación (objeto) van al JSONB `ratios`; el resto son columnas. Las red
   * flags (solo PDF) se adjuntan como JSONB.
   */
  private toAnalysisInput(
    indicators: FinancialIndicators,
    reliabilityFlags: unknown[],
  ): Omit<
    Prisma.FinancialAnalysisUncheckedCreateInput,
    'customerId' | 'companyId' | 'createdBy' | 'source'
  > {
    const { ratios, ...core } = indicators;
    return {
      ...core,
      ratios: ratios as unknown as Prisma.InputJsonValue,
      reliabilityFlags: toJson(reliabilityFlags),
    };
  }

  /** Análisis financieros congelados por un estudio. */
  async findByCreditStudy(creditStudyId: string, companyId: string) {
    const study = await this.repository.findCreditStudy(
      creditStudyId,
      companyId,
    );
    if (!study) {
      throw new NotFoundException(
        `Estudio de crédito con id=${creditStudyId} no encontrado en esta empresa`,
      );
    }
    return this.repository.findAnalysesByCreditStudy(creditStudyId);
  }

  // ── Helpers ──────────────────────────────────────────────

  /** Label del Parameter income_statement (p.ej. '12' = anual). */
  private async resolvePeriodLabel(
    incomeStatementId?: number | null,
  ): Promise<string> {
    if (!incomeStatementId) return '12';
    const param = await this.parametersRepository.findById(incomeStatementId);
    return param?.label ?? '12';
  }

  /**
   * Construye un FinancialStatementPeriod (cifras crudas de UN año) desde el
   * período que devolvió la IA. El fiscalYear sale de la IA; si falta, se infiere
   * del balanceSheetDate y, en último caso, del dto.fiscalYear.
   */
  private buildPeriod(
    p: ExtractedPeriod,
    companyId: string,
    customerId: string,
    createdBy: string,
    dto: ExtractPdfDto,
  ): Prisma.FinancialStatementPeriodUncheckedCreateInput {
    const balanceSheetDate =
      typeof p.balanceSheetDate === 'string' && p.balanceSheetDate
        ? new Date(p.balanceSheetDate)
        : undefined;

    const fiscalYear =
      (typeof p.fiscalYear === 'number' ? p.fiscalYear : null) ??
      balanceSheetDate?.getUTCFullYear() ??
      dto.fiscalYear ??
      null;
    if (fiscalYear === null) {
      throw new BadRequestException(
        'No se pudo determinar el año fiscal de un período: la IA no devolvió fiscalYear ni fecha de balance. Envía fiscalYear.',
      );
    }

    const figures: Record<string, number | null | undefined> = {};
    for (const field of PERIOD_FIGURE_FIELDS) {
      figures[field] = p[field];
    }

    return {
      companyId,
      customerId,
      createdBy,
      source: 'pdf_upload',
      fiscalYear,
      incomeStatementId: dto.incomeStatementId ?? null,
      balanceSheetDate,
      ...figures,
    };
  }

  /**
   * Arma las cifras que consume computeFinancialIndicators a partir del par de
   * períodos más recientes: el corriente aporta todo (EERR + saldos de cierre) y
   * el anterior solo los saldos de apertura (*_2) para promediar rotaciones. El
   * helper (algoritmo Altman) queda intacto: se le entrega el formato *_1 / *_2.
   */
  private toIndicatorFigures(
    current: Prisma.FinancialStatementPeriodUncheckedCreateInput,
    prior: Prisma.FinancialStatementPeriodUncheckedCreateInput | undefined,
  ): FinancialStatementRawFigures {
    const num = (v: unknown): number | null | undefined =>
      v as number | null | undefined;
    return {
      totalCurrentAssets: num(current.totalCurrentAssets),
      totalCurrentLiabilities: num(current.totalCurrentLiabilities),
      totalAssets: num(current.totalAssets),
      retainedEarnings: num(current.retainedEarnings),
      grossProfit: num(current.grossProfit),
      administrativeExpenses: num(current.administrativeExpenses),
      sellingExpenses: num(current.sellingExpenses),
      equity: num(current.equity),
      totalLiabilities: num(current.totalLiabilities),
      ordinaryActivityRevenue: num(current.ordinaryActivityRevenue),
      costOfSales: num(current.costOfSales),
      depreciation: num(current.depreciation),
      amortization: num(current.amortization),
      shortTermFinancialLiabilities: num(current.shortTermFinancialLiabilities),
      longTermFinancialLiabilities: num(current.longTermFinancialLiabilities),
      financialExpenses: num(current.financialExpenses),
      netIncome: num(current.netIncome),
      // Pares para rotaciones: cierre (corriente) + apertura (anterior).
      accountsReceivable1: num(current.accountsReceivable),
      accountsReceivable2: num(prior?.accountsReceivable),
      inventories1: num(current.inventories),
      inventories2: num(prior?.inventories),
      suppliers1: num(current.suppliers),
      suppliers2: num(prior?.suppliers),
      // Totales del año anterior para ratios de variación/crecimiento.
      totalAssets2: num(prior?.totalAssets),
      totalLiabilities2: num(prior?.totalLiabilities),
      equity2: num(prior?.equity),
      ordinaryActivityRevenue2: num(prior?.ordinaryActivityRevenue),
    };
  }
}
