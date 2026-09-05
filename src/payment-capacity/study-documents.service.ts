import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { StudyDocumentsRepository } from './study-documents.repository.js';
import { AiAnalysesService } from '../ai-analyses/ai-analyses.service.js';
import { ParametersRepository } from '../parameters/parameters.repository.js';
import { SupabaseService } from '../auth/supabase.service.js';
import { LOCKED_STUDY_STATUSES } from '../credit-studies/credit-study-status.constants.js';
import { buildBankStatementExtractionPrompt } from '../ai/prompts/bank-statement-extraction.prompt.js';
import { buildPayrollStubExtractionPrompt } from '../ai/prompts/payroll-stub-extraction.prompt.js';
import { buildContractorInvoiceExtractionPrompt } from '../ai/prompts/contractor-invoice-extraction.prompt.js';
import {
  normalizeBankStatement,
  normalizeContractorInvoice,
  normalizePayrollStub,
} from './extraction/normalize.js';
import type {
  PayrollStubExtraction,
  StudyDocumentExtraction,
  StudyDocumentTypeCode,
  ValidationOutcome,
} from './extraction/extraction.types.js';
import {
  validateBankStatementInternals,
  validateContractorInvoice,
  validateIdentity,
  validatePayrollStub,
} from './validation/document-validations.js';
import { idNumbersMatch } from './validation/identity-match.js';
import {
  computeCoverage,
  isPayrollPeriodCurrent,
  monthsInRange,
  type CoverageInfo,
} from './coverage.js';
import {
  MAX_BANK_STATEMENTS,
  MAX_CONTRACTOR_INVOICES,
  MAX_PAYROLL_STUBS,
} from './engine/payment-capacity.constants.js';
import { Prisma } from '../../generated/prisma/client.js';

/** Cardinalidad máxima por tipo de documento (filas no-error por estudio). */
const MAX_BY_TYPE: Record<StudyDocumentTypeCode, number> = {
  bankStatement: MAX_BANK_STATEMENTS,
  payrollStub: MAX_PAYROLL_STUBS,
  contractorInvoice: MAX_CONTRACTOR_INVOICES,
};

/** Code del Parameter ai_analysis_type que registra la corrida por tipo. */
const AI_TYPE_BY_DOC: Record<StudyDocumentTypeCode, string> = {
  bankStatement: 'bankStatementPdfExtraction',
  payrollStub: 'payrollStubPdfExtraction',
  contractorInvoice: 'contractorInvoicePdfExtraction',
};

type StudyForDocuments = NonNullable<
  Awaited<ReturnType<StudyDocumentsRepository['findStudyForDocuments']>>
>;

@Injectable()
export class StudyDocumentsService {
  private readonly logger = new Logger(StudyDocumentsService.name);
  private readonly storageBucket: string;

  constructor(
    private readonly repository: StudyDocumentsRepository,
    private readonly aiAnalysesService: AiAnalysesService,
    private readonly parametersRepository: ParametersRepository,
    private readonly supabaseService: SupabaseService,
    configService: ConfigService,
  ) {
    this.storageBucket =
      configService.get<string>('SUPABASE_STORAGE_BUCKET_STUDY_DOCUMENTS') ??
      'study-documents';
  }

  /**
   * Sube un documento del estudio de capacidad y lo procesa completo en línea:
   * PDF → Storage → extracción IA (AiAnalysis sin binario) → normalización en
   * código → validaciones intra-documento (V1–V3/V6 extracto, V8–V10 nómina,
   * checksum factura, V5 identidad) → persistencia. Si con este documento la
   * cobertura mínima queda satisfecha, el estudio avanza a pendingStudyAnalysis.
   */
  async upload(params: {
    companyId: string;
    creditStudyId: string;
    userId: string;
    documentTypeCode: StudyDocumentTypeCode;
    fileName: string;
    fileBuffer: Buffer;
  }) {
    const study = await this.getCapacityStudy(
      params.creditStudyId,
      params.companyId,
    );

    if (study.status?.code && LOCKED_STUDY_STATUSES.has(study.status.code)) {
      throw new BadRequestException(
        'Este estudio ya está confirmado o cerrado: no admite más documentos.',
      );
    }

    this.assertProfileAllowsType(study, params.documentTypeCode);

    const documentType = await this.parametersRepository.findByTypeAndCode(
      'study_document_type',
      params.documentTypeCode,
    );
    if (!documentType) {
      throw new NotFoundException(
        `Parámetro study_document_type '${params.documentTypeCode}' no encontrado. Debe crearse en la tabla de parámetros.`,
      );
    }
    await this.assertCardinality(
      params.creditStudyId,
      params.documentTypeCode,
      documentType.id,
    );

    // El binario vive en Storage con el id de la fila como nombre; se sube
    // ANTES de crear la fila para no persistir un documento sin archivo.
    const documentId = randomUUID();
    const storagePath = `${params.companyId}/${params.creditStudyId}/${documentId}.pdf`;
    await this.supabaseService.uploadFile(
      this.storageBucket,
      storagePath,
      params.fileBuffer,
      'application/pdf',
    );

    await this.repository.create({
      id: documentId,
      creditStudyId: params.creditStudyId,
      companyId: params.companyId,
      documentTypeId: documentType.id,
      fileName: params.fileName,
      fileSizeBytes: params.fileBuffer.length,
      storagePath,
      extractionStatus: 'pending',
      uploadedBy: params.userId,
    });

    let document;
    try {
      document = await this.extractAndValidate({
        documentId,
        documentTypeCode: params.documentTypeCode,
        fileBuffer: params.fileBuffer,
        study,
        userId: params.userId,
      });
    } catch (error) {
      // La fila queda en error (visible y borrable en el front) y no cuenta
      // para la cardinalidad ni la cobertura. La corrida fallida ya quedó
      // logueada en AiAnalysis por extractStudyDocument.
      const message =
        error instanceof Error ? error.message : 'Error desconocido';
      await this.repository.update(documentId, {
        extractionStatus: 'error',
        extractionError: message,
      });
      throw error;
    }

    const coverage = await this.refreshStudyProgress(study);
    return { document, coverage };
  }

  /** Documentos del estudio + cobertura agregada (nunca los movimientos). */
  async list(creditStudyId: string, companyId: string) {
    const study = await this.getCapacityStudy(creditStudyId, companyId);
    const documents = await this.repository.findByStudy(creditStudyId);
    return { documents, coverage: this.coverageFrom(study, documents) };
  }

  /** URL firmada (1 hora) para ver/descargar el PDF original desde el front. */
  async getFileUrl(
    documentId: string,
    creditStudyId: string,
    companyId: string,
  ) {
    await this.getCapacityStudy(creditStudyId, companyId);
    const document = await this.repository.findOne(
      documentId,
      creditStudyId,
      companyId,
    );
    if (!document) {
      throw new NotFoundException(
        `Documento con id=${documentId} no encontrado en este estudio`,
      );
    }
    const expiresInSeconds = 3600;
    const url = await this.supabaseService.createSignedUrl(
      this.storageBucket,
      document.storagePath,
      expiresInSeconds,
    );
    return { url, expiresInSeconds, fileName: document.fileName };
  }

  /**
   * Elimina un documento (fila + binario en Storage, best-effort). Si al
   * quitarlo la cobertura deja de estar completa y el estudio aún no fue
   * analizado, retrocede a pendingFinancialStatements para que el front vuelva
   * a pedir documentos.
   */
  async remove(documentId: string, creditStudyId: string, companyId: string) {
    const study = await this.getCapacityStudy(creditStudyId, companyId);

    if (study.status?.code && LOCKED_STUDY_STATUSES.has(study.status.code)) {
      throw new BadRequestException(
        'Este estudio ya está confirmado o cerrado: no se pueden eliminar documentos.',
      );
    }

    const document = await this.repository.findOne(
      documentId,
      creditStudyId,
      companyId,
    );
    if (!document) {
      throw new NotFoundException(
        `Documento con id=${documentId} no encontrado en este estudio`,
      );
    }

    await this.repository.delete(documentId);
    await this.supabaseService.deleteFile(
      this.storageBucket,
      document.storagePath,
    );

    const coverage = await this.refreshStudyProgress(study);
    return { success: true, coverage };
  }

  // ─── Pipeline de extracción + validación de un documento ─────────────────

  private async extractAndValidate(params: {
    documentId: string;
    documentTypeCode: StudyDocumentTypeCode;
    fileBuffer: Buffer;
    study: StudyForDocuments;
    userId: string;
  }) {
    const { study } = params;
    const prompt = this.promptFor(params.documentTypeCode);

    const extraction = await this.aiAnalysesService.extractStudyDocument({
      pdfBuffer: params.fileBuffer,
      prompt,
      typeCode: AI_TYPE_BY_DOC[params.documentTypeCode],
      // Los codes de documento coinciden con los perfiles de extracción.
      extractionKind: params.documentTypeCode,
      companyId: study.companyId,
      userId: params.userId,
      creditStudyId: study.id,
      customerId: study.customerId,
    });

    const { doc, summary, validations, periodFrom, periodTo, accountLast4 } =
      this.normalizeAndValidate(
        params.documentTypeCode,
        extraction.parsed,
        study.customer,
      );

    if (params.documentTypeCode === 'payrollStub') {
      await this.assertPayrollStubIsCurrent(
        study.id,
        (doc as PayrollStubExtraction).period,
      );
    }

    return this.repository.update(params.documentId, {
      extractionStatus: 'success',
      extractionError: null,
      aiAnalysisId: extraction.aiAnalysisId,
      extractedData: doc as unknown as Prisma.InputJsonValue,
      summary: summary as Prisma.InputJsonValue,
      extractionFlags:
        extraction.extractionFlags as unknown as Prisma.InputJsonValue,
      validationResults: validations as unknown as Prisma.InputJsonValue,
      periodFrom,
      periodTo,
      accountLast4,
    });
  }

  private normalizeAndValidate(
    typeCode: StudyDocumentTypeCode,
    parsed: Record<string, unknown>,
    customer: StudyForDocuments['customer'],
  ): {
    doc: StudyDocumentExtraction;
    summary: Record<string, unknown>;
    validations: ValidationOutcome[];
    periodFrom: Date | null;
    periodTo: Date | null;
    accountLast4: string | null;
  } {
    switch (typeCode) {
      case 'bankStatement': {
        const doc = normalizeBankStatement(parsed);
        const validations = [
          ...validateBankStatementInternals(doc),
          validateIdentity(
            [{ source: 'extracto', name: doc.account.holderName }],
            customer.businessName,
          ),
        ];
        return {
          doc,
          summary: {
            bank: doc.account.bank,
            accountType: doc.account.accountType,
            accountLast4: doc.account.accountNumberLast4,
            holderName: doc.account.holderName,
            period: doc.period,
            previousBalance: doc.summary.previousBalance,
            totalCredits: doc.summary.totalCredits,
            totalDebits: doc.summary.totalDebits,
            finalBalance: doc.summary.finalBalance,
            averageBalance: doc.summary.averageBalance,
            movementCount: doc.movements.length,
          },
          validations,
          periodFrom: this.toDate(doc.period.from),
          periodTo: this.toDate(doc.period.to),
          accountLast4: doc.account.accountNumberLast4,
        };
      }
      case 'payrollStub': {
        const doc = normalizePayrollStub(parsed);
        const validations = [
          ...validatePayrollStub(doc),
          validateIdentity(
            [{ source: 'desprendible', name: doc.employee.name }],
            customer.businessName,
          ),
        ];
        // Cédula impresa en el desprendible vs la identidad consultada: más
        // fuerte que el nombre cuando viene (V5 también, es la misma pregunta).
        if (doc.employee.idNumber && customer.identificationNumber) {
          const matched = idNumbersMatch(
            doc.employee.idNumber,
            customer.identificationNumber,
          );
          validations.push({
            code: 'V5',
            label: 'Cédula del desprendible',
            passed: matched,
            severity: 'danger',
            detail: matched
              ? `La cédula del desprendible coincide con la identidad consultada.`
              : `La cédula del desprendible (${doc.employee.idNumber}) NO coincide con la del cliente (${customer.identificationNumber}).`,
          });
        }
        const { from, to } = this.monthToRange(doc.period);
        return {
          doc,
          summary: {
            employerName: doc.employer.name,
            employeeName: doc.employee.name,
            period: doc.period,
            hireDate: doc.hireDate,
            baseSalary: doc.baseSalary,
            netPay: doc.netPay,
            totals: doc.totals,
            depositBank: doc.depositAccount?.bank ?? null,
            depositAccountLast4: doc.depositAccount?.accountNumberLast4 ?? null,
            conceptCount: doc.concepts.length,
          },
          validations,
          periodFrom: from,
          periodTo: to,
          accountLast4: doc.depositAccount?.accountNumberLast4 ?? null,
        };
      }
      case 'contractorInvoice': {
        const doc = normalizeContractorInvoice(parsed);
        const validations = [
          ...validateContractorInvoice(doc),
          validateIdentity(
            [{ source: 'factura', name: doc.contractor.name }],
            customer.businessName,
          ),
        ];
        return {
          doc,
          summary: {
            invoiceNumber: doc.invoiceNumber,
            issueDate: doc.issueDate,
            period: doc.period,
            clientName: doc.client.name,
            clientCountry: doc.client.country,
            currency: doc.currency,
            total: doc.total,
            contractorName: doc.contractor.name,
          },
          validations,
          periodFrom: this.toDate(doc.period?.from ?? doc.issueDate),
          periodTo: this.toDate(doc.period?.to ?? doc.issueDate),
          accountLast4: null,
        };
      }
    }
  }

  /**
   * Un desprendible de un período muy anterior a los extractos no acredita el
   * ingreso actual. Se rechaza al cargarlo —cuando el usuario tiene el
   * documento a mano y puede reemplazarlo— si ya hay extractos contra los que
   * medirlo. Si los sube en el otro orden no hay ventana todavía: ahí la red
   * es el análisis, que degrada el ingreso al del extracto y lo declara.
   */
  private async assertPayrollStubIsCurrent(
    creditStudyId: string,
    period: string | null,
  ) {
    const documents = await this.repository.findByStudy(creditStudyId);
    const statements = documents.filter(
      (d) =>
        d.documentType.code === 'bankStatement' &&
        d.extractionStatus === 'success',
    );
    const months = [
      ...new Set(
        statements.flatMap((d) =>
          d.periodFrom && d.periodTo
            ? monthsInRange(
                d.periodFrom.toISOString().slice(0, 10),
                d.periodTo.toISOString().slice(0, 10),
              )
            : [],
        ),
      ),
    ].sort();

    if (!isPayrollPeriodCurrent(period, months)) {
      throw new BadRequestException(
        `El desprendible es del período ${period} y los extractos cargados cubren ${months[0]} a ${months[months.length - 1]}. ` +
          'Aporta un desprendible de ese período: uno anterior no acredita el ingreso actual.',
      );
    }
  }

  // ─── Cobertura y avance/retroceso de estado ──────────────────────────────

  /**
   * Recalcula la cobertura tras subir/eliminar y mueve el estado del estudio:
   * completa → pendingStudyAnalysis; incompleta (y aún sin analizar) →
   * pendingFinancialStatements. Estados posteriores no se tocan: re-cargar un
   * documento sobre un estudio ya analizado no lo retrocede.
   */
  private async refreshStudyProgress(
    study: StudyForDocuments,
  ): Promise<CoverageInfo> {
    const documents = await this.repository.findByStudy(study.id);
    const coverage = this.coverageFrom(study, documents);

    const statusCode = study.status?.code;
    const target = coverage.complete
      ? statusCode === 'pendingFinancialStatements'
        ? 'pendingStudyAnalysis'
        : null
      : statusCode === 'pendingStudyAnalysis' && study.viabilityScore === null
        ? 'pendingFinancialStatements'
        : null;

    if (target) {
      const next = await this.parametersRepository.findByCode(target);
      if (next) {
        await this.repository.updateStudyStatus(study.id, next.id);
      }
    }
    return coverage;
  }

  private coverageFrom(
    study: StudyForDocuments,
    documents: Awaited<ReturnType<StudyDocumentsRepository['findByStudy']>>,
  ): CoverageInfo {
    const success = documents.filter((d) => d.extractionStatus === 'success');
    const byType = (code: StudyDocumentTypeCode) =>
      success.filter((d) => d.documentType.code === code);

    return computeCoverage({
      employmentType:
        study.employmentType?.code === 'independent'
          ? 'independent'
          : 'salaried',
      statementPeriods: byType('bankStatement').map((d) => ({
        from: d.periodFrom ? d.periodFrom.toISOString().slice(0, 10) : null,
        to: d.periodTo ? d.periodTo.toISOString().slice(0, 10) : null,
      })),
      payrollStubs: byType('payrollStub').length,
      contractorInvoices: byType('contractorInvoice').length,
    });
  }

  // ─── Guards ──────────────────────────────────────────────────────────────

  private async getCapacityStudy(
    creditStudyId: string,
    companyId: string,
  ): Promise<StudyForDocuments> {
    const study = await this.repository.findStudyForDocuments(
      creditStudyId,
      companyId,
    );
    if (!study) {
      throw new NotFoundException(
        `Estudio de crédito con id=${creditStudyId} no encontrado en esta empresa`,
      );
    }
    if (study.studyType?.code !== 'paymentCapacity') {
      throw new BadRequestException(
        'Este estudio no es de capacidad de pago: los documentos de ingreso solo aplican a ese tipo de estudio.',
      );
    }
    return study;
  }

  /** El tipo de documento debe corresponder al perfil laboral declarado. */
  private assertProfileAllowsType(
    study: StudyForDocuments,
    typeCode: StudyDocumentTypeCode,
  ) {
    const employment = study.employmentType?.code;
    if (employment === 'salaried' && typeCode === 'contractorInvoice') {
      throw new BadRequestException(
        'Un asalariado acredita su ingreso con desprendibles de nómina, no con facturas.',
      );
    }
    if (employment === 'independent' && typeCode === 'payrollStub') {
      throw new BadRequestException(
        'Un independiente acredita su ingreso con extractos ampliados y facturas, no con desprendibles de nómina.',
      );
    }
  }

  private async assertCardinality(
    creditStudyId: string,
    typeCode: StudyDocumentTypeCode,
    documentTypeId: number,
  ) {
    const counts = await this.repository.countByType(creditStudyId);
    const current =
      counts.find((c) => c.documentTypeId === documentTypeId)?._count._all ?? 0;
    const max = MAX_BY_TYPE[typeCode];
    if (current >= max) {
      throw new BadRequestException(
        `Este estudio ya tiene ${current} documento(s) de este tipo (máximo ${max}). Elimina uno antes de subir otro.`,
      );
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private promptFor(typeCode: StudyDocumentTypeCode): string {
    switch (typeCode) {
      case 'bankStatement':
        return buildBankStatementExtractionPrompt();
      case 'payrollStub':
        return buildPayrollStubExtractionPrompt();
      case 'contractorInvoice':
        return buildContractorInvoiceExtractionPrompt();
    }
  }

  private toDate(iso: string | null | undefined): Date | null {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    return new Date(`${iso}T00:00:00.000Z`);
  }

  /** Período de nómina 'YYYY-MM' → primer y último día del mes. */
  private monthToRange(period: string | null): {
    from: Date | null;
    to: Date | null;
  } {
    if (!period || !/^\d{4}-\d{2}$/.test(period)) {
      return { from: null, to: null };
    }
    const [year, month] = period.split('-').map(Number);
    return {
      from: new Date(Date.UTC(year, month - 1, 1)),
      to: new Date(Date.UTC(year, month, 0)),
    };
  }
}
