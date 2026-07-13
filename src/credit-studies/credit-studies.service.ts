import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { CreditStudiesRepository } from './credit-studies.repository.js';
import { FilterCreditStudyDto } from './dto/filter-credit-study.dto.js';
import { CreateStudyFromBureauDto } from './dto/create-study-from-bureau.dto.js';
import { Prisma } from '../../generated/prisma/client.js';
import { ParametersRepository } from '../parameters/parameters.repository.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ExcelService } from '../common/excel/excel.service.js';
import type { ExcelColumn, ExcelSheet } from '../common/excel/excel.types.js';
import { AnalysisPacksService } from '../analysis-packs/analysis-packs.service.js';
import { CreditBureauService } from '../credit-bureau/credit-bureau.service.js';
import { runScoring } from '../scoring/scoring.engine.js';
import {
  defaultWeightsFor,
  PDF_RELIABILITY_FLAG_CATEGORY_LABEL,
  type ScoringDimension,
  type PersonTypeCode,
} from '../scoring/scoring.constants.js';
import type {
  ScoringEngineInput,
  ScoringIndicators,
  GrossFigures,
  CentralRiskInput,
  PdfReliabilityFlag,
  PaymentBehaviorMonth,
  LegalStatusInput,
} from '../scoring/scoring.types.js';

interface ViabilityDimension {
  score?: number;
  maxScore?: number;
  status?: string;
  label?: string;
  reason?: string;
}

interface ViabilityAlert {
  type: string;
  dimension: string;
  message: string;
}

interface ViabilityConditionsShape {
  dimensions?: Record<string, ViabilityDimension>;
  alerts?: ViabilityAlert[];
  summary?: {
    totalScore?: number;
    maxScore?: number;
    status?: string;
    recommendedTerm?: number;
    recommendedCreditLine?: number;
    monthlyPaymentCapacity?: number;
    annualPaymentCapacity?: number;
  };
}

// Estados desde los que el estudio queda BLOQUEADO para editar/eliminar: una vez
// el usuario confirma (o rechaza) el estudio realizado, ya no se toca. Cubre el
// resto del flujo de cierre/firma.
const LOCKED_STUDY_STATUSES = new Set([
  'confirmed',
  'rejected',
  'pendingSignature',
  'closed',
]);

@Injectable()
export class CreditStudiesService {
  constructor(
    private readonly repository: CreditStudiesRepository,
    private readonly parametersRepository: ParametersRepository,
    private readonly notificationsService: NotificationsService,
    private readonly excelService: ExcelService,
    private readonly analysisPacksService: AnalysisPacksService,
    private readonly creditBureauService: CreditBureauService,
  ) {}

  /**
   * ÚNICA entrada para crear un estudio de crédito. Consulta al cliente en la
   * central (reusando caché si su última consulta sigue vigente) — lo que
   * crea/actualiza el Customer — y con ese cliente crea el estudio, consumiendo
   * 1 crédito de una bolsa vigente. El estudio nace "vacío" (solo la solicitud);
   * los estados financieros y la viabilidad se completan después.
   *
   * Estado inicial: TODO estudio (PN y PJ) nace en pendingFinancialStatements —
   * ambos deben cargar EEFF (en PN se obligó a subir PDF) antes de analizar. El
   * flujo avanza: pendingFinancialStatements → (extract-pdf) pendingStudyAnalysis
   * → (perform) studyCompleted.
   */
  async createFromBureau(
    companyId: string,
    userId: string,
    dto: CreateStudyFromBureauDto,
  ) {
    // 1. Consultar la central (crea/actualiza el Customer). Si no hay info, el
    //    servicio de bureau lanza 404 "cliente no existe".
    const { customer } = await this.creditBureauService.consult(
      companyId,
      userId,
      dto,
    );

    // 2. Estado inicial: TODO estudio (PN y PJ) exige estados financieros antes
    //    de analizar. Para PN, como Experian no reporta EEFF, el análisis corre
    //    sobre el PDF que el usuario debe cargar → mismo estado inicial que PJ.
    const initialStatus = await this.parametersRepository.findByCode(
      'pendingFinancialStatements',
    );
    if (!initialStatus) {
      throw new BadRequestException(
        `No se encontró el estado inicial "pendingFinancialStatements" en parámetros.`,
      );
    }

    // 3. Crear el estudio consumiendo 1 crédito (FIFO + lock anti doble-venta).
    //    Sin saldo → 409. studyDate = hoy.
    const study = await this.analysisPacksService.consumeCreditForStudy({
      companyId,
      consumedBy: userId,
      createStudy: (tx) =>
        this.repository.create(
          {
            customerId: customer.id,
            companyId,
            studyDate: new Date(),
            requestedTerm: dto.requestedTerm,
            requestedCreditLine: dto.requestedCreditLine,
            createdBy: userId,
            updatedBy: userId,
            statusId: initialStatus.id,
          },
          tx,
        ),
    });

    // 4. El front consume el stepper vía GET /:id/steps (única fuente de verdad).
    //    Aquí solo se devuelve el id del estudio recién creado.
    return { creditStudyId: study.id };
  }

  /**
   * Datos del stepper de un estudio, consultado por id. Es la ÚNICA fuente que
   * arma la vista del wizard del front:
   *  - step1: identidad del cliente + su perfil de bureau (lo que trajo la
   *    consulta a la central). Siempre presente (el estudio nace de una consulta).
   *  - step2: estados financieros. null hasta que se carguen/extraigan.
   *  - step3: estudio de viabilidad. null hasta que se realice.
   * El `status` del estudio va al nivel raíz (no dentro de un step).
   */
  async getSteps(id: string, companyId: string) {
    const study = await this.repository.findStepsData(id, companyId);
    if (!study) {
      throw new NotFoundException(
        `Estudio de crédito con id=${id} no encontrado en esta empresa`,
      );
    }

    // Flag directo del tipo de persona para el front (evita comparar strings o
    // resolver el id opaco). El objeto customer.personType (code/label) queda
    // igual para mostrarlo legible.
    const isLegalEntity = study.customer?.personType?.code === 'legalEntity';

    // step2: estados financieros por fuente (pdf_upload / datacredito). Cada
    // fuente trae sus 2 años más recientes (cifras crudas) + indicadores del
    // núcleo + ratios de presentación. null si aún no hay ningún análisis.
    const step2 = await this.buildFinancialStep(id);

    // step3: análisis de viabilidad realizado (score + dimensiones + veredicto).
    // null hasta que se realiza el estudio (POST /:id/perform). El núcleo se arma
    // con el MISMO builder que usa el perform → idéntico en ambos endpoints. Si
    // además ya existe informe IA (creditReview) para el estudio, se adjunta aquí
    // (el perform no lo trae porque en ese momento aún no se ha generado).
    const base = this.buildStep3(study);
    const aiRow = study.aiAnalyses?.[0] ?? null;
    const step3 = base
      ? {
          ...base,
          aiAnalysis: aiRow
            ? {
                id: aiRow.id,
                result: aiRow.result,
                model: aiRow.model,
                createdAt: aiRow.createdAt,
                performedBy: aiRow.performedBy,
              }
            : null,
        }
      : null;

    return {
      creditStudyId: study.id,
      status: study.status,
      // Información básica del estudio (la solicitud), al mismo nivel que el id
      // para que el front la muestre en la cabecera sin abrir un step. NO es el
      // resultado del análisis (eso vive en step3).
      studyDate: study.studyDate,
      request: {
        requestedTerm: study.requestedTerm,
        requestedCreditLine: study.requestedCreditLine,
      },
      step1: { isLegalEntity, customer: study.customer },
      step2,
      step3,
    };
  }

  /**
   * Arma el bloque step3 (resultado del análisis de viabilidad) a partir de un
   * estudio. ÚNICA fuente del shape: lo usan tanto GET /:id/steps como
   * POST /:id/perform, para que ambos devuelvan un objeto IDÉNTICO. Devuelve null
   * si el estudio aún no fue analizado (sin viabilityConditions).
   */
  private buildStep3(study: {
    viabilityScore: number | null;
    viabilityStatus: string | null;
    recommendedCreditLine: number | null;
    recommendedTerm: number | null;
    resolutionDate: Date | null;
    viabilityConditions: unknown;
  }) {
    if (!study.viabilityConditions) return null;
    return {
      viabilityScore: study.viabilityScore,
      viabilityStatus: study.viabilityStatus,
      recommendedCreditLine: study.recommendedCreditLine,
      recommendedTerm: study.recommendedTerm,
      resolutionDate: study.resolutionDate,
      result: study.viabilityConditions,
    };
  }

  /**
   * Arma el step2 (estados financieros) de un estudio a partir de sus análisis
   * congelados. Devuelve una lista `sources`, una por análisis, con sus períodos
   * crudos (2 años), los indicadores del núcleo y los ratios. Devuelve null si el
   * estudio aún no tiene análisis (paso no iniciado).
   */
  private async buildFinancialStep(creditStudyId: string) {
    const analyses = await this.repository.findFrozenAnalyses(creditStudyId);
    if (analyses.length === 0) return null;

    const sources = analyses.map((a) => {
      const { ratios, periods, ...indicators } = a;
      return {
        source: indicators.source,
        analysisId: indicators.id,
        periods,
        ratios: ratios ?? null,
        indicators: {
          stabilityFactor: indicators.stabilityFactor,
          ebitda: indicators.ebitda,
          adjustedEbitda: indicators.adjustedEbitda,
          currentDebtService: indicators.currentDebtService,
          annualPaymentCapacity: indicators.annualPaymentCapacity,
          monthlyPaymentCapacity: indicators.monthlyPaymentCapacity,
          accountsReceivableTurnover: indicators.accountsReceivableTurnover,
          inventoryTurnover: indicators.inventoryTurnover,
          suppliersTurnover: indicators.suppliersTurnover,
          paymentTimeSuppliers: indicators.paymentTimeSuppliers,
          accountsPayableTurnover: indicators.accountsPayableTurnover,
        },
        reliabilityFlags: indicators.reliabilityFlags ?? null,
      };
    });

    return { sources };
  }

  /**
   * REALIZA el análisis de viabilidad de un estudio (step3). Corre el motor de
   * scoring de 7 dimensiones sobre la FUENTE DE VERDAD (DataCrédito) con fallback
   * al PDF, contrasta veracidad PDF↔DataCrédito, pondera con la config vigente de
   * la empresa, graba esa config en el estudio (congelación) y persiste el
   * resultado (viabilityConditions + score + status). Devuelve el estudio con el
   * análisis realizado.
   */
  async performStudy(id: string, companyId: string, userId: string) {
    const inputs = await this.repository.findAnalysisInputs(id, companyId);
    if (!inputs) {
      throw new NotFoundException(
        `Estudio de crédito con id=${id} no encontrado en esta empresa`,
      );
    }
    const { study, analyses, riskSnapshot, scoringConfig } = inputs;

    // Bloquear si ya está confirmado/cerrado.
    if (study.status?.code && LOCKED_STUDY_STATUSES.has(study.status.code)) {
      throw new BadRequestException(
        'No se puede re-analizar un estudio ya confirmado o cerrado.',
      );
    }

    // Fuente de verdad = DataCrédito; fallback = PDF. Cada uno es un análisis
    // congelado con sus indicadores/ratios y sus períodos (año corriente).
    const datacredito = analyses.find((a) => a.source === 'datacredito');
    const pdf = analyses.find((a) => a.source === 'pdf_upload');
    const truthAnalysis = datacredito ?? pdf;

    if (!truthAnalysis) {
      throw new BadRequestException(
        'No hay estados financieros (ni de DataCrédito ni de PDF) para analizar este estudio. Cargue el PDF de estados financieros primero.',
      );
    }

    // Config de scoring: la vigente de la empresa PARA EL TIPO DE PERSONA del
    // cliente; si no hay (empresa antigua sin config), se usan los pesos default
    // del tipo en memoria (no se congela id).
    const personTypeCode = (study.customer.personType?.code ??
      'legalEntity') as PersonTypeCode;
    const weights = scoringConfig
      ? this.configToWeights(scoringConfig)
      : defaultWeightsFor(personTypeCode);

    // Armar la entrada del motor.
    const engineInput: ScoringEngineInput = {
      weights,
      personType: personTypeCode,
      request: {
        requestedTerm: study.requestedTerm,
        requestedCreditLine: study.requestedCreditLine,
      },
      indicators: this.analysisToIndicators(truthAnalysis),
      truthFigures: datacredito
        ? this.analysisToGrossFigures(datacredito)
        : null,
      pdfFigures: pdf ? this.analysisToGrossFigures(pdf) : null,
      centralRisk: this.riskToCentralInput(riskSnapshot),
      legalStatus: this.toLegalStatus(study.customer.bureauProfile),
    };

    const result = runScoring(engineInput);

    // Inyectar las red flags de FIABILIDAD del PDF (auditan el PDF contra sí
    // mismo; las genera la IA al extraer los EEFF). El motor no las conoce: viven
    // en el análisis de fuente 'pdf'. Se copian al resultado para que el estudio
    // muestre TODO junto (fiabilidad del PDF + contraste con la central).
    result.pdfReliabilityFlags = this.extractReliabilityFlags(pdf);

    // Avanzar el flujo: al realizar el análisis el estudio pasa a
    // "Estudio Realizado" (studyCompleted). La confirmación/rechazo posterior es
    // otro paso. Si el parámetro no existe, se deja el estado como está (no
    // rompe el análisis).
    const completedStatus =
      await this.parametersRepository.findByCode('studyCompleted');

    // Persistir: score/status/config congelada + el JSON de viabilidad + el
    // avance de estado del flujo. Aquí se marca la resolución.
    const updated = await this.repository.update(id, {
      viabilityScore: result.summary.totalScore,
      viabilityStatus: result.summary.status,
      viabilityConditions: result as unknown as Prisma.InputJsonValue,
      // Monto que Creditia avala (nunca por encima del techo de la central).
      recommendedCreditLine: result.approvedCreditLine.amount,
      recommendedTerm: study.requestedTerm,
      scoringConfigurationId: scoringConfig?.id ?? null,
      ...(completedStatus ? { statusId: completedStatus.id } : {}),
      resolutionDate: new Date(),
      updatedBy: userId,
    });

    // Devolver el MISMO objeto que expone GET /:id/steps → step3. Así el front
    // reutiliza un solo mapper para el resultado del análisis, venga del perform
    // o del stepper.
    return this.buildStep3(updated);
  }

  // ── Helpers del análisis ─────────────────────────────────

  /** Pesos de la config (columnas) → mapa por dimensión que consume el motor. */
  private configToWeights(config: {
    weightFinancialHealth: number;
    weightPaymentCapacity: number;
    weightTermCoherence: number;
    weightCreditLineAdequacy: number;
    weightCapitalExposure: number;
    weightVeracity: number;
    weightCentralRisk: number;
  }): Record<ScoringDimension, number> {
    return {
      financialHealth: config.weightFinancialHealth,
      paymentCapacity: config.weightPaymentCapacity,
      termCoherence: config.weightTermCoherence,
      creditLineAdequacy: config.weightCreditLineAdequacy,
      capitalExposure: config.weightCapitalExposure,
      veracity: config.weightVeracity,
      centralRisk: config.weightCentralRisk,
    };
  }

  /** Indicadores del análisis (columnas de FinancialAnalysis) → entrada del motor. */
  private analysisToIndicators(analysis: {
    monthlyPaymentCapacity: number | null;
    annualPaymentCapacity: number | null;
    currentDebtService: number | null;
    ebitda: number | null;
    accountsReceivableTurnover: number | null;
    inventoryTurnover: number | null;
    paymentTimeSuppliers: number | null;
    stabilityFactor: number | null;
  }): ScoringIndicators {
    return {
      monthlyPaymentCapacity: analysis.monthlyPaymentCapacity ?? 0,
      annualPaymentCapacity: analysis.annualPaymentCapacity ?? 0,
      currentDebtService: analysis.currentDebtService ?? 0,
      ebitda: analysis.ebitda ?? 0,
      accountsReceivableTurnover: analysis.accountsReceivableTurnover ?? 0,
      inventoryTurnover: analysis.inventoryTurnover ?? 0,
      paymentTimeSuppliers: analysis.paymentTimeSuppliers ?? 0,
      stabilityFactor: analysis.stabilityFactor ?? 0,
    };
  }

  /** Cifras gruesas del año corriente (el período más reciente) de un análisis. */
  private analysisToGrossFigures(analysis: {
    periods: Array<{
      fiscalYear: number;
      ordinaryActivityRevenue: number | null;
      totalAssets: number | null;
      totalLiabilities: number | null;
      equity: number | null;
      netIncome: number | null;
    }>;
  }): GrossFigures | null {
    // periods ya viene ordenado fiscalYear DESC (el [0] es el corriente).
    const current = analysis.periods[0];
    if (!current) return null;
    return {
      ordinaryActivityRevenue: current.ordinaryActivityRevenue,
      totalAssets: current.totalAssets,
      totalLiabilities: current.totalLiabilities,
      equity: current.equity,
      netIncome: current.netIncome,
    };
  }

  /**
   * Red flags de fiabilidad del PDF (columna JSONB del análisis 'pdf'). Se
   * normalizan al shape estable de salida. Si no hubo PDF o no hay flags → [].
   */
  private extractReliabilityFlags(
    pdf: { reliabilityFlags: unknown } | undefined,
  ): PdfReliabilityFlag[] {
    const raw = pdf?.reliabilityFlags;
    if (!Array.isArray(raw)) return [];
    return raw.map((f) => {
      const flag = f as Partial<PdfReliabilityFlag>;
      const category = flag.category ?? 'otro';
      return {
        severity: flag.severity ?? 'info',
        category,
        categoryLabel:
          PDF_RELIABILITY_FLAG_CATEGORY_LABEL[category] ?? category,
        title: flag.title ?? '',
        detail: flag.detail ?? '',
      };
    });
  }

  /** Snapshot de riesgo → entrada de la Dim 7. Trae el vector de mora completo. */
  private riskToCentralInput(
    snapshot: {
      nivelRiesgo: string | null;
      ratingSectorial: string | null;
      score: number | null;
      montoSugerido: number | null;
      porcentajeDeuda: number | null;
      saldoMora: number | null;
      paymentBehavior: unknown;
    } | null,
  ): CentralRiskInput | null {
    if (!snapshot) return null;
    return {
      nivelRiesgo: snapshot.nivelRiesgo,
      ratingSectorial: snapshot.ratingSectorial,
      score: snapshot.score,
      montoSugerido: snapshot.montoSugerido,
      porcentajeDeuda: snapshot.porcentajeDeuda,
      saldoMora: snapshot.saldoMora,
      hasArrears: this.hasArrears(snapshot.paymentBehavior),
      paymentBehavior: this.toPaymentBehavior(snapshot.paymentBehavior),
    };
  }

  /** Normaliza el vector de comportamiento de pago del snapshot al shape del motor. */
  private toPaymentBehavior(raw: unknown): PaymentBehaviorMonth[] | null {
    if (!Array.isArray(raw)) return null;
    return (raw as Array<{ anioMes?: unknown; comportamiento?: unknown }>).map(
      (m) => ({
        anioMes: typeof m?.anioMes === 'string' ? m.anioMes : null,
        comportamiento:
          typeof m?.comportamiento === 'string' ? m.comportamiento : null,
      }),
    );
  }

  /**
   * Estado legal del cliente (matrícula / liquidación) desde el bureauProfile
   * (JSONB del Customer). Alimenta la regla eliminatoria del motor. null si no
   * hay perfil (p. ej. PN sin perfil de bureau).
   */
  private toLegalStatus(bureauProfile: unknown): LegalStatusInput | null {
    if (!bureauProfile || typeof bureauProfile !== 'object') return null;
    const p = bureauProfile as {
      registration?: { status?: unknown };
      generalProfile?: { inLiquidation?: unknown };
    };
    const registrationStatus =
      typeof p.registration?.status === 'string'
        ? p.registration.status
        : null;
    const inLiquidation =
      typeof p.generalProfile?.inLiquidation === 'string'
        ? p.generalProfile.inLiquidation
        : null;
    if (registrationStatus === null && inLiquidation === null) return null;
    return { registrationStatus, inLiquidation };
  }

  /**
   * ¿El vector de comportamiento de pago muestra mora? Mora = algún mes con
   * código distinto de 'N' (al día) y de '-'/' ' (sin información). Los códigos
   * 1-6, C, D son mora (ver catálogo PAYMENT_BEHAVIOR).
   */
  private hasArrears(paymentBehavior: unknown): boolean {
    if (!Array.isArray(paymentBehavior)) return false;
    const items = paymentBehavior as Array<{ comportamiento?: unknown }>;
    return items.some((item) => {
      const raw = item?.comportamiento;
      const code = (typeof raw === 'string' ? raw : '').trim().toUpperCase();
      return code !== '' && code !== 'N' && code !== '-';
    });
  }

  async findAll(companyId: string, filters: FilterCreditStudyDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const skip = (page - 1) * limit;

    const where: Prisma.CreditStudyWhereInput = { companyId };

    if (filters.customerId) {
      where.customerId = filters.customerId;
    }

    if (filters.statusId) {
      where.statusId = filters.statusId;
    }

    if (filters.studyDateFrom || filters.studyDateTo) {
      where.studyDate = {};
      if (filters.studyDateFrom) {
        where.studyDate.gte = new Date(filters.studyDateFrom);
      }
      if (filters.studyDateTo) {
        where.studyDate.lte = new Date(filters.studyDateTo);
      }
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
      orderBy: { studyDate: 'desc' },
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
    const study = await this.repository.findById(id, companyId);
    if (!study) {
      throw new NotFoundException(
        `Estudio de crédito con id=${id} no encontrado en esta empresa`,
      );
    }

    // Flags derivados de los AiAnalysis ya cargados (sin query extra):
    // ¿el estudio ya tuvo un análisis IA y/o una extracción de PDF exitosos?
    const successful = study.aiAnalyses.filter((a) => a.status === 'success');
    const hasAiAnalysis = successful.some(
      (a) => a.type?.code === 'creditReview',
    );
    const hasPdfExtraction = successful.some(
      (a) => a.type?.code === 'financialStatementsPdfUpload',
    );

    return { ...study, hasAiAnalysis, hasPdfExtraction };
  }

  async exportToExcel(companyId: string) {
    const studies = await this.repository.findAllForExport(companyId);

    // NOTA: las cifras crudas de estados financieros (balance/EERR) ya no viven
    // en CreditStudy sino en FinancialStatement. El export de esas columnas se
    // reincorporará cuando se defina el flujo nuevo (join estudio↔EEFF). Por
    // ahora el export cubre identidad, solicitud y resultado/viabilidad.
    const mainRows = studies.map((s) => ({
      studyDate: s.studyDate,
      resolutionDate: s.resolutionDate,
      status: s.status?.label ?? null,
      customerBusinessName: s.customer?.businessName ?? null,
      customerIdentification: s.customer?.identificationNumber ?? null,
      requestedTerm: s.requestedTerm,
      requestedCreditLine: s.requestedCreditLine,
      recommendedTerm: s.recommendedTerm,
      recommendedCreditLine: s.recommendedCreditLine,
      viabilityScore: s.viabilityScore,
      viabilityStatus: s.viabilityStatus,
      notes: s.notes,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));

    const mainColumns: ExcelColumn<(typeof mainRows)[number]>[] = [
      { header: 'Fecha estudio', key: 'studyDate', type: 'date', width: 14 },
      {
        header: 'Fecha resolución',
        key: 'resolutionDate',
        type: 'date',
        width: 16,
      },
      { header: 'Estado', key: 'status', type: 'string', width: 18 },
      {
        header: 'Cliente',
        key: 'customerBusinessName',
        type: 'string',
        width: 30,
      },
      {
        header: 'Identificación cliente',
        key: 'customerIdentification',
        type: 'string',
        width: 22,
      },
      {
        header: 'Plazo solicitado (días)',
        key: 'requestedTerm',
        type: 'number',
        width: 18,
      },
      {
        header: 'Cupo solicitado',
        key: 'requestedCreditLine',
        type: 'currency',
        width: 20,
      },
      {
        header: 'Plazo recomendado (días)',
        key: 'recommendedTerm',
        type: 'number',
        width: 20,
      },
      {
        header: 'Cupo recomendado',
        key: 'recommendedCreditLine',
        type: 'currency',
        width: 20,
      },
      {
        header: 'Score viabilidad',
        key: 'viabilityScore',
        type: 'number',
        width: 16,
      },
      {
        header: 'Estado viabilidad',
        key: 'viabilityStatus',
        type: 'string',
        width: 18,
      },
      { header: 'Notas', key: 'notes', type: 'string', width: 40 },
      { header: 'Creado', key: 'createdAt', type: 'datetime', width: 20 },
      { header: 'Actualizado', key: 'updatedAt', type: 'datetime', width: 20 },
    ];

    const dimensionRows: Array<{
      studyDate: Date;
      customer: string | null;
      dimension: string;
      score: number | null;
      maxScore: number | null;
      status: string | null;
      reason: string | null;
    }> = [];

    const alertRows: Array<{
      studyDate: Date;
      customer: string | null;
      type: string;
      dimension: string;
      message: string;
    }> = [];

    for (const s of studies) {
      const vc = (s.viabilityConditions ??
        null) as ViabilityConditionsShape | null;
      if (!vc) continue;

      const customerName = s.customer?.businessName ?? null;

      if (vc.dimensions) {
        for (const [key, dim] of Object.entries(vc.dimensions)) {
          if (key === 'paymentSuggestions') continue;
          dimensionRows.push({
            studyDate: s.studyDate,
            customer: customerName,
            dimension: dim.label ?? key,
            score: dim.score ?? null,
            maxScore: dim.maxScore ?? null,
            status: dim.status ?? null,
            reason: dim.reason ?? null,
          });
        }
      }

      if (vc.alerts) {
        for (const alert of vc.alerts) {
          alertRows.push({
            studyDate: s.studyDate,
            customer: customerName,
            type: alert.type,
            dimension: alert.dimension,
            message: alert.message,
          });
        }
      }
    }

    const sheets: ExcelSheet[] = [
      {
        name: 'Estudios',
        columns: mainColumns,
        data: mainRows,
      },
      {
        name: 'Viabilidad - Dimensiones',
        columns: [
          {
            header: 'Fecha estudio',
            key: 'studyDate',
            type: 'date',
            width: 14,
          },
          { header: 'Cliente', key: 'customer', type: 'string', width: 30 },
          { header: 'Dimensión', key: 'dimension', type: 'string', width: 24 },
          { header: 'Score', key: 'score', type: 'number', width: 10 },
          { header: 'Máximo', key: 'maxScore', type: 'number', width: 10 },
          { header: 'Estado', key: 'status', type: 'string', width: 18 },
          { header: 'Razón', key: 'reason', type: 'string', width: 80 },
        ],
        data: dimensionRows,
      },
      {
        name: 'Viabilidad - Alertas',
        columns: [
          {
            header: 'Fecha estudio',
            key: 'studyDate',
            type: 'date',
            width: 14,
          },
          { header: 'Cliente', key: 'customer', type: 'string', width: 30 },
          { header: 'Tipo', key: 'type', type: 'string', width: 14 },
          { header: 'Dimensión', key: 'dimension', type: 'string', width: 22 },
          { header: 'Mensaje', key: 'message', type: 'string', width: 80 },
        ],
        data: alertRows,
      },
    ];

    const timestamp = new Date().toISOString().slice(0, 10);

    return this.excelService.generate({
      fileName: `estudios-credito-${timestamp}`,
      sheets,
    });
  }
}
