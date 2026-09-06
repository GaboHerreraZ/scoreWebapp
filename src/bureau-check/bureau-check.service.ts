import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { BureauCheckRepository } from './bureau-check.repository.js';
import { CreateBureauCheckDto } from './dto/create-bureau-check.dto.js';
import { ParametersRepository } from '../parameters/parameters.repository.js';
import { AnalysisPacksService } from '../analysis-packs/analysis-packs.service.js';
import { CreditBureauService } from '../credit-bureau/credit-bureau.service.js';
import { CustomerAuthorizationsService } from '../customer-authorizations/customer-authorizations.service.js';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service.js';
import { AiAnalysesService } from '../ai-analyses/ai-analyses.service.js';
import { PdfService } from '../common/pdf/pdf.service.js';
import { LOCKED_STUDY_STATUSES } from '../credit-studies/credit-study-status.constants.js';
import {
  BUREAU_CHECK_SYSTEM_PROMPT,
  buildBureauCheckUserMessage,
  type BureauCheckPromptInput,
} from '../ai/prompts/bureau-check-analysis.prompt.js';
import { buildBureauCheckReportViewModel } from './pdf/bureau-check-report.mapper.js';
import { renderBureauCheckHtml } from './pdf/bureau-check-report.renderer.js';
import type {
  MappedPaymentBehaviorItem,
  MappedCreditSector,
  MappedRiskAlert,
  MappedBureauSuggestion,
  MappedBalanceEvolutionPoint,
} from '../credit-bureau/providers/provider-result.js';
import {
  buildAmountComparison,
  buildPaymentTimeline,
  buildPaymentStats,
  buildBalanceTrend,
  buildSectorTotals,
  namesMatch,
  normalizeAnalysis,
  type AmountComparison,
  type NormalizedAnalysis,
} from './bureau-check-analysis.utils.js';
import type { Prisma } from '../../generated/prisma/client.js';

const NOT_AVAILABLE_MSG =
  'La consulta de riesgo crediticio no está disponible en este momento.';
const PN_ONLY_MSG =
  'La consulta de riesgo crediticio aplica solo a personas naturales';

type StudyRow = NonNullable<
  Awaited<ReturnType<BureauCheckRepository['findWithSnapshot']>>
>;
type SnapshotRow = NonNullable<StudyRow['customer']>['riskSnapshots'][number];

@Injectable()
export class BureauCheckService {
  constructor(
    private readonly repository: BureauCheckRepository,
    private readonly parametersRepository: ParametersRepository,
    private readonly analysisPacksService: AnalysisPacksService,
    private readonly creditBureauService: CreditBureauService,
    private readonly authorizationsService: CustomerAuthorizationsService,
    private readonly featureFlagsService: FeatureFlagsService,
    private readonly aiAnalysesService: AiAnalysesService,
    private readonly pdfService: PdfService,
  ) {}

  /**
   * Crea una consulta de riesgo: gate de autorización (Ley 1266, mismo Zapsign
   * de los estudios) → consulta a la central (con su caché) → consumo de la
   * bolsa bureauCheck → fila en credit_studies (pendingStudyAnalysis). El front
   * llama perform inmediatamente después: para el usuario es un solo flujo.
   */
  async create(companyId: string, userId: string, dto: CreateBureauCheckDto) {
    // Kill switch: bloquea crear consultas nuevas; las existentes siguen vivas.
    if (!(await this.featureFlagsService.isEnabled('bureauCheck'))) {
      throw new BadRequestException(NOT_AVAILABLE_MSG);
    }
    // El DTO ya excluye 'nit'; cinturón por si llega por otra vía.
    if (dto.identificationTypeCode === 'nit') {
      throw new BadRequestException(PN_ONLY_MSG);
    }
    const studyType = await this.parametersRepository.findByTypeAndCode(
      'study_type',
      'bureauCheck',
    );
    if (!studyType) {
      throw new BadRequestException(
        'No se encontró el tipo de estudio "bureauCheck" en parámetros.',
      );
    }

    const gate = await this.authorizationsService.resolveForConsult(
      companyId,
      userId,
      {
        identificationTypeCode: dto.identificationTypeCode,
        identificationNumber: dto.numeroIdentificacion,
        titularName: dto.apellidoRazonSocial,
        titularEmail: dto.titularEmail,
        titularCity: dto.titularCity,
      },
    );
    if (!gate.authorized) {
      return {
        status: 'authorization_pending' as const,
        authorization: gate.authorization,
      };
    }

    const { customer } = await this.creditBureauService.consult(
      companyId,
      userId,
      dto,
      dto.titularEmail,
    );

    // Cinturón: la central pudo resolver la identidad como persona jurídica.
    // Se corta ANTES de consumir bolsa.
    const naturalPerson = await this.parametersRepository.findByTypeAndCode(
      'person_type',
      'naturalPerson',
    );
    if (customer.personTypeId !== naturalPerson?.id) {
      throw new BadRequestException(PN_ONLY_MSG);
    }

    const initialStatus = await this.parametersRepository.findByCode(
      'pendingStudyAnalysis',
    );
    if (!initialStatus) {
      throw new BadRequestException(
        'No se encontró el estado inicial "pendingStudyAnalysis" en parámetros.',
      );
    }

    const study = await this.analysisPacksService.consumeCreditForStudy({
      companyId,
      consumedBy: userId,
      productCode: 'bureauCheck',
      createStudy: (tx) =>
        this.repository.create(
          {
            customerId: customer.id,
            companyId,
            studyDate: new Date(),
            studyTypeId: studyType.id,
            requestedTerm: null,
            requestedCreditLine: dto.requestedCreditLine ?? null,
            createdBy: userId,
            updatedBy: userId,
            statusId: initialStatus.id,
          },
          tx,
        ),
    });

    return { status: 'created' as const, creditStudyId: study.id };
  }

  /**
   * EL ANÁLISIS: la IA interpreta el snapshot de la central (resumen, nivel,
   * red flags, señales, secciones) y el código calcula las cifras clave y el
   * contraste de monto. Si la IA falla, la consulta queda en
   * pendingStudyAnalysis y el reintento es gratis. Re-perform permitido
   * mientras no esté cerrada (reemplaza el análisis).
   */
  async perform(id: string, companyId: string, userId: string) {
    const study = await this.findBureauCheckOr404(id, companyId);
    if (study.status?.code && LOCKED_STUDY_STATUSES.has(study.status.code)) {
      throw new BadRequestException(
        'No se puede re-analizar una consulta ya confirmada o cerrada.',
      );
    }
    const snapshot = study.customer?.riskSnapshots?.[0] ?? null;
    if (!snapshot || !study.customer) {
      throw new BadRequestException(
        'La consulta no tiene resultado de la central para analizar.',
      );
    }

    const amountComparison = buildAmountComparison(
      study.requestedCreditLine,
      snapshot.montoSugerido,
    );
    const keyFigures = this.buildKeyFigures(snapshot);
    const promptInput = this.buildPromptInput(
      study.customer.businessName,
      study.requestedCreditLine,
      amountComparison,
      snapshot,
    );

    let analysis: NormalizedAnalysis;
    let analysisId: string | null = null;
    try {
      const run = await this.aiAnalysesService.runBureauCheckAnalysis({
        systemPrompt: BUREAU_CHECK_SYSTEM_PROMPT,
        userMessage: buildBureauCheckUserMessage(promptInput),
        companyId,
        userId,
        creditStudyId: id,
        customerId: study.customer.id,
      });
      analysisId = run.analysisId;
      analysis = normalizeAnalysis(run.parsed);
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'error desconocido';
      throw new BadRequestException(
        `El análisis no se pudo generar: ${reason} La consulta no se pierde: vuelva a intentarlo.`,
      );
    }

    await this.repository.upsertAnalysis({
      creditStudyId: id,
      companyId,
      createdBy: userId,
      summary: analysis.summary,
      riskLevel: analysis.riskLevel,
      redFlags: analysis.redFlags as unknown as Prisma.InputJsonValue,
      positiveSignals:
        analysis.positiveSignals as unknown as Prisma.InputJsonValue,
      sections: analysis.sections as unknown as Prisma.InputJsonValue,
      keyFigures: keyFigures as unknown as Prisma.InputJsonValue,
      amountComparison: amountComparison as unknown as Prisma.InputJsonValue,
      recommendations:
        analysis.recommendations as unknown as Prisma.InputJsonValue,
      aiAnalysisId: analysisId,
    });

    const completed =
      await this.parametersRepository.findByCode('studyCompleted');
    if (completed) {
      await this.repository.updateStatus(id, completed.id, userId);
    }

    return this.getDetail(id, companyId);
  }

  /**
   * Detalle de la consulta: identidad del titular + el análisis (informe
   * digerido). El snapshot crudo de la central NO viaja: por políticas de uso
   * el entregable es siempre el dato transformado.
   */
  async getDetail(id: string, companyId: string) {
    const study = await this.findBureauCheckOr404(id, companyId);

    const customerRow = study.customer;
    const customer = customerRow
      ? (() => {
          const { riskSnapshots, daneCity, bureauCity, ...rest } = customerRow;
          void riskSnapshots;
          return {
            ...rest,
            city: daneCity?.name ?? bureauCity ?? null,
            state: daneCity?.region.name ?? null,
          };
        })()
      : null;

    // Verificación de identidad: nombre digitado al pedir la autorización vs
    // el registrado en la central. matches=null cuando falta alguno.
    let identity: {
      typedName: string | null;
      centralName: string | null;
      matches: boolean | null;
    } | null = null;
    if (customerRow) {
      const typedName = await this.authorizationsService.getTypedTitularName(
        companyId,
        customerRow.identificationNumber,
      );
      identity = {
        typedName,
        centralName: customerRow.businessName,
        matches: namesMatch(typedName, customerRow.businessName),
      };
    }

    const a = study.bureauCheckAnalysis;
    return {
      creditStudyId: study.id,
      status: study.status,
      studyDate: study.studyDate,
      requestedCreditLine: study.requestedCreditLine,
      customer,
      identity,
      analysis: a
        ? {
            summary: a.summary,
            riskLevel: a.riskLevel,
            redFlags: a.redFlags,
            positiveSignals: a.positiveSignals,
            sections: a.sections,
            keyFigures: a.keyFigures,
            amountComparison: a.amountComparison,
            recommendations: a.recommendations,
            createdAt: a.createdAt,
            updatedAt: a.updatedAt,
          }
        : null,
    };
  }

  /** Informe PDF con plantilla propia (marca Creditia + atribución de fuente). */
  async generateReportPdf(id: string, companyId: string) {
    const detail = await this.getDetail(id, companyId);
    if (!detail.analysis) {
      throw new BadRequestException(
        'La consulta aún no tiene análisis: genérelo antes de descargar el informe.',
      );
    }
    const company = await this.repository.findCompanyHeader(companyId);

    const generatedAt = new Intl.DateTimeFormat('es-CO', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).format(new Date());

    const viewModel = buildBureauCheckReportViewModel(
      detail,
      {
        name: company?.name ?? null,
        nit: company?.nit ?? null,
        city: company?.daneCity?.name ?? null,
      },
      generatedAt,
    );
    const html = renderBureauCheckHtml(viewModel);
    const buffer = await this.pdfService.htmlToPdf(html, {
      footerHtml: `<div style="width:100%;font-size:8px;color:#9ca3af;padding:0 14mm;text-align:right;">
        Página <span class="pageNumber"></span> de <span class="totalPages"></span>
      </div>`,
      margin: { top: '16mm', bottom: '18mm', left: '14mm', right: '14mm' },
    });

    const safeName = (detail.customer?.businessName ?? 'consulta')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
    const fileName = `consulta-riesgo-${safeName || 'consulta'}.pdf`;

    return { buffer, fileName };
  }

  private async findBureauCheckOr404(id: string, companyId: string) {
    const study = await this.repository.findWithSnapshot(id, companyId);
    if (!study || study.studyType?.code !== 'bureauCheck') {
      throw new NotFoundException(
        `Consulta de riesgo con id=${id} no encontrada en esta empresa`,
      );
    }
    return study;
  }

  /** Subset curado del snapshot que SÍ viaja al front (dato transformado). */
  private buildKeyFigures(snapshot: SnapshotRow) {
    const sectors =
      (snapshot.creditSectors as unknown as MappedCreditSector[] | null) ?? [];
    const behavior =
      (snapshot.paymentBehavior as unknown as
        | MappedPaymentBehaviorItem[]
        | null) ?? null;
    const alerts =
      (snapshot.alerts as unknown as MappedRiskAlert[] | null) ?? [];
    const evolution =
      (snapshot.balanceEvolution as unknown as
        | MappedBalanceEvolutionPoint[]
        | null) ?? null;

    // La central lista SIEMPRE los 4 sectores, aunque vengan en cero: cuenta
    // solo los que registran créditos (vigentes o cerrados) o saldo.
    const activeSectors = sectors.filter(
      (s) =>
        Number(s.creditosVigentes ?? 0) > 0 ||
        Number(s.creditosCerrados ?? 0) > 0 ||
        (s.saldoActual ?? 0) > 0,
    );
    const totals = buildSectorTotals(sectors);
    const paymentTimeline = buildPaymentTimeline(behavior);
    const paymentStats = buildPaymentStats(paymentTimeline);

    return {
      consultedAt: snapshot.createdAt,
      score: snapshot.score,
      viabilidad: snapshot.viabilidadLabel ?? snapshot.viabilidad,
      ratingRecaudos: snapshot.ratingRecaudosLabel ?? snapshot.ratingRecaudos,
      txtProbabilidad: snapshot.txtProbabilidad,
      saldoActual: snapshot.saldoActual,
      saldoMora: snapshot.saldoMora,
      porcentajeDeuda: snapshot.porcentajeDeuda,
      montoSugerido: snapshot.montoSugerido,
      reportedIncome: snapshot.reportedIncome,
      quotaToIncomePct: snapshot.quotaToIncomePct,
      hasAlertas: snapshot.hasAlertas,
      sectorsWithCredits: activeSectors.length,
      creditosVigentes: totals.vigentes,
      creditosCerrados: totals.cerrados,
      valorCuota: totals.valorCuota,
      totalCodeudorOtros: totals.totalCodeudorOtros,
      // Bloques transformados para pintar en formato propio (nunca el layout
      // de la central): sectores con actividad, línea de tiempo y alertas.
      sectorActivity: activeSectors.map((s) => ({
        sector: s.sector,
        description: s.sectorLabel,
        vigentes: Number(s.creditosVigentes) || 0,
        cerrados: Number(s.creditosCerrados) || 0,
        saldoActual: s.saldoActual,
        saldoMora: s.saldoMora,
        porcentajeDeuda: s.porcentajeDeuda,
        valorCuota: s.valorCuota,
      })),
      paymentTimeline,
      paymentStats,
      balanceTrend: buildBalanceTrend(evolution),
      alertsDetail: alerts
        .filter((a) => a.message)
        .map((a) => ({ message: a.message, date: a.date ?? null })),
    };
  }

  private buildPromptInput(
    titularName: string | null,
    requestedCreditLine: number | null,
    amountComparison: AmountComparison,
    snapshot: SnapshotRow,
  ): BureauCheckPromptInput {
    const behavior =
      (snapshot.paymentBehavior as unknown as
        | MappedPaymentBehaviorItem[]
        | null) ?? [];
    const sectors =
      (snapshot.creditSectors as unknown as MappedCreditSector[] | null) ?? [];
    const alerts =
      (snapshot.alerts as unknown as MappedRiskAlert[] | null) ?? [];
    const suggestions =
      (snapshot.suggestions as unknown as MappedBureauSuggestion[] | null) ??
      [];
    const evolution =
      (snapshot.balanceEvolution as unknown as
        | MappedBalanceEvolutionPoint[]
        | null) ?? null;
    const totals = buildSectorTotals(sectors);

    return {
      titularName,
      requestedCreditLine,
      amountComparison: {
        requested: amountComparison.requested,
        suggested: amountComparison.suggested,
        verdictLabel: amountComparison.verdictLabel,
      },
      snapshot: {
        score: snapshot.score,
        viabilidad: snapshot.viabilidadLabel ?? snapshot.viabilidad,
        ratingRecaudos: snapshot.ratingRecaudosLabel ?? snapshot.ratingRecaudos,
        txtProbabilidad: snapshot.txtProbabilidad,
        txtRecaudos: snapshot.txtRecaudos,
        saldoActual: snapshot.saldoActual,
        saldoMora: snapshot.saldoMora,
        porcentajeDeuda: snapshot.porcentajeDeuda,
        montoSugerido: snapshot.montoSugerido,
        reportedIncome: snapshot.reportedIncome,
        quotaToIncomePct: snapshot.quotaToIncomePct,
        valorCuota: totals.valorCuota,
        totalCodeudorOtros: totals.totalCodeudorOtros,
        hasAlertas: snapshot.hasAlertas,
        alerts: alerts
          .filter((a) => !!a.message)
          .map((a) => ({ message: a.message, date: a.date ?? null })),
        paymentBehavior: behavior.map((b) => ({
          month: b.anioMes,
          code: b.comportamiento,
          label: b.comportamientoLabel,
        })),
        creditSectors: sectors.map((c) => ({
          sector: c.sectorLabel ?? c.sector,
          vigentes: c.creditosVigentes,
          cerrados: c.creditosCerrados,
          saldoActual: c.saldoActual,
          saldoMora: c.saldoMora,
          porcentajeDeuda: c.porcentajeDeuda,
          valorCuota: c.valorCuota,
          totalCodeudorOtros: c.totalCodeudorOtros,
        })),
        balanceTrend: buildBalanceTrend(evolution)?.label ?? null,
        suggestions: suggestions.map((g) => ({
          title: g.title,
          items: g.items ?? [],
        })),
      },
    };
  }
}
