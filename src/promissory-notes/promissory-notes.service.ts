import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { PromissoryNotesRepository } from './promissory-notes.repository.js';
import { ParametersRepository } from '../parameters/parameters.repository.js';
import { DocuSealService } from './docuseal.service.js';
import { SupabaseService } from '../auth/supabase.service.js';
import { CreatePromissoryNoteDto } from './dto/create-promissory-note.dto.js';
import { DocuSealWebhookPayload } from './dto/docuseal-webhook.dto.js';
import { numberToSpanishWords } from './utils/number-to-words.js';

// ── Hardcoded payment schedule values (temporary — will come from DB later) ──
const HARDCODED_PAYMENT_METHOD = 'DOS PLAZOS';
const HARDCODED_PAYMENT_DAY = '15';
const HARDCODED_PAYMENT_MONTH = 'Diciembre';
const HARDCODED_PAYMENT_YEAR = '2026';

const SPANISH_MONTHS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

@Injectable()
export class PromissoryNotesService {
  private readonly logger = new Logger(PromissoryNotesService.name);
  private readonly templateId: number;
  private readonly storageBucket: string;

  constructor(
    private readonly repository: PromissoryNotesRepository,
    private readonly prisma: PrismaService,
    private readonly parametersRepository: ParametersRepository,
    private readonly docusealService: DocuSealService,
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {
    this.templateId = Number(
      this.configService.get<string>('DOCUSEAL_PROMISSORY_TEMPLATE_ID') ?? 0,
    );
    this.storageBucket =
      this.configService.get<string>('SUPABASE_STORAGE_BUCKET_PROMISSORY') ??
      'promissory-notes';
  }

  async create(
    companyId: string,
    userId: string,
    dto: CreatePromissoryNoteDto,
  ) {
    if (!this.templateId) {
      throw new BadRequestException(
        'La plantilla de DocuSeal no está configurada en el servidor.',
      );
    }

    // 1. Load the credit study with customer and company details
    const creditStudy = await this.prisma.creditStudy.findFirst({
      where: { id: dto.creditStudyId, companyId },
      include: {
        customer: { include: { identificationType: true } },
        company: { include: { accountType: true, accountBank: true } },
      },
    });

    if (!creditStudy) {
      throw new NotFoundException(
        'El estudio de crédito no existe o no pertenece a esta empresa.',
      );
    }

    const { customer, company } = creditStudy;

    // 2. Derive the amount from the credit study's requested monthly credit line
    if (
      creditStudy.requestedMonthlyCreditLine === null ||
      creditStudy.requestedMonthlyCreditLine === undefined ||
      creditStudy.requestedMonthlyCreditLine <= 0
    ) {
      throw new BadRequestException(
        'El estudio de crédito no tiene un cupo mensual solicitado válido. No se puede generar el pagaré.',
      );
    }

    const amount = Math.trunc(creditStudy.requestedMonthlyCreditLine);
    const amountInWords = numberToSpanishWords(amount);

    // 3. Enforce: only one active promissory note per credit study (for now)
    const activeCount = await this.repository.countActiveByCreditStudy(
      dto.creditStudyId,
    );
    if (activeCount > 0) {
      throw new ConflictException(
        'Este estudio de crédito ya tiene un pagaré activo (pendiente de firma o firmado).',
      );
    }

    // 4. Validate customer has required data for the document
    this.validateCustomer(customer);

    // 5. Validate company has bank account configured
    this.validateCompany(company);

    // 6. Resolve pending status parameter
    const pendingStatus = await this.parametersRepository.findByTypeAndCode(
      'promissory_note_status',
      'PENDING_SIGNATURE',
    );
    if (!pendingStatus) {
      throw new BadRequestException(
        'No se encontró el estado "Pendiente de firma" en la base de datos. Contacta al administrador.',
      );
    }

    // 7. Create the promissory note record (transactional with DocuSeal call below)
    const promissoryNote = await this.repository.create({
      companyId,
      creditStudyId: dto.creditStudyId,
      customerId: customer.id,
      createdBy: userId,
      statusId: pendingStatus.id,
      amount,
      amountInWords,
    });

    // 8. Build DocuSeal submission payload and send
    try {
      const values = this.buildDocuSealValues({
        promissoryNoteId: promissoryNote.id,
        amount,
        amountInWords,
        customer,
        company,
      });

      const submitter = await this.docusealService.createSubmission({
        templateId: this.templateId,
        signerEmail: customer.email!,
        signerName: customer.businessName,
        values,
      });

      // 9. Persist DocuSeal identifiers on the record
      const updated = await this.repository.update(promissoryNote.id, {
        docusealSubmissionId: submitter.submissionId,
        docusealSubmitterId: submitter.id,
        docusealSubmitterUuid: submitter.uuid,
        docusealSlug: submitter.slug,
        signingUrl: submitter.embedSrc,
        sentAt: submitter.sentAt ? new Date(submitter.sentAt) : new Date(),
      });

      return updated;
    } catch (err) {
      // Rollback: delete the local record so the user can retry
      this.logger.error(
        `DocuSeal submission failed, rolling back promissory note ${promissoryNote.id}`,
        err as Error,
      );
      await this.prisma.promissoryNote.delete({
        where: { id: promissoryNote.id },
      });
      throw err;
    }
  }

  async findById(id: number, companyId: string) {
    const note = await this.repository.findById(id, companyId);
    if (!note) {
      throw new NotFoundException(
        `No se encontró el pagaré con id=${id} en esta empresa.`,
      );
    }
    return note;
  }

  async findAll(companyId: string, page = 1, limit = 10) {
    const skip = (page - 1) * limit;
    const { data, total } = await this.repository.findAll({
      skip,
      take: limit,
      where: { companyId },
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

  /**
   * Handles a DocuSeal webhook event.
   *
   * Security model: the webhook endpoint is public and there is NO HMAC
   * signature on DocuSeal webhooks. To prevent a forged webhook from marking a
   * promissory note as signed, we treat the payload as an untrusted
   * notification and independently verify the submission state against
   * DocuSeal's API using the authenticated API key before taking any action.
   * Only the status returned by DocuSeal is persisted.
   */
  async handleDocuSealWebhook(payload: DocuSealWebhookPayload): Promise<void> {
    const eventType = payload.event_type;
    this.logger.log(`Received DocuSeal webhook event: ${eventType}`);

    const submissionId =
      payload.data?.submission_id ?? payload.data?.submission?.id ?? null;

    if (!submissionId) {
      this.logger.warn(
        `DocuSeal webhook ${eventType} has no submission id, ignoring`,
      );
      return;
    }

    const note = await this.repository.findByDocusealSubmissionId(submissionId);
    if (!note) {
      this.logger.warn(
        `No promissory note found for DocuSeal submission ${submissionId}`,
      );
      return;
    }

    // Authoritative check: ask DocuSeal for the real state of this submission
    // with our API key. If an attacker forged the webhook, this call will
    // reveal the submission is still `pending` and nothing is persisted.
    const state = await this.docusealService.getSubmissionState(submissionId);

    if (state.status === 'completed') {
      await this.handleSubmissionCompleted(note.id, submissionId);
      return;
    }

    if (state.status === 'declined') {
      const declinedStatus = await this.parametersRepository.findByTypeAndCode(
        'promissory_note_status',
        'DECLINED',
      );
      await this.repository.update(note.id, {
        statusId: declinedStatus?.id,
        declinedAt: new Date(),
      });
      return;
    }

    if (state.status === 'expired') {
      const expiredStatus = await this.parametersRepository.findByTypeAndCode(
        'promissory_note_status',
        'EXPIRED',
      );
      await this.repository.update(note.id, {
        statusId: expiredStatus?.id,
      });
      return;
    }

    this.logger.log(
      `DocuSeal submission ${submissionId} is still ${state.status}, ignoring webhook`,
    );
  }

  // ─────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────

  private async handleSubmissionCompleted(
    promissoryNoteId: number,
    submissionId: number,
  ): Promise<void> {
    // 1. Load minimal note context (companyId + creditStudyId) in a single query
    const note = await this.prisma.promissoryNote.findUnique({
      where: { id: promissoryNoteId },
      select: { companyId: true, creditStudyId: true },
    });

    if (!note) {
      this.logger.error(
        `Promissory note ${promissoryNoteId} disappeared before completion handler ran`,
      );
      return;
    }

    // 2. Fetch the signed document URL from DocuSeal
    const signedDocumentUrl =
      await this.docusealService.getSignedDocumentUrl(submissionId);

    if (!signedDocumentUrl) {
      this.logger.error(`DocuSeal submission ${submissionId} has no documents`);
      return;
    }

    // 3. Download the PDF and upload it to Supabase Storage for safekeeping
    let storagePath: string | null = null;
    try {
      const pdfBuffer =
        await this.docusealService.downloadDocument(signedDocumentUrl);
      const path = `${note.companyId}/${promissoryNoteId}.pdf`;
      storagePath = await this.supabaseService.uploadFile(
        this.storageBucket,
        path,
        pdfBuffer,
        'application/pdf',
      );
    } catch (err) {
      this.logger.error(
        `Failed to persist signed PDF to Supabase Storage for promissory note ${promissoryNoteId}`,
        err as Error,
      );
      // Continue — we still mark as SIGNED and keep the DocuSeal URL as fallback
    }

    // 4. Mark the promissory note as SIGNED
    const signedStatus = await this.parametersRepository.findByTypeAndCode(
      'promissory_note_status',
      'SIGNED',
    );
    await this.repository.update(promissoryNoteId, {
      statusId: signedStatus?.id,
      signedAt: new Date(),
      signedDocumentUrl,
      signedFileStoragePath: storagePath,
    });

    // 5. Close the credit study by moving it to `estudioCompletado`
    const completedStudyStatus = await this.parametersRepository.findByCode(
      'estudioCompletado',
    );
    if (!completedStudyStatus) {
      this.logger.warn(
        'Parameter with code "estudioCompletado" not found — credit study status was not updated',
      );
      return;
    }

    await this.prisma.creditStudy.update({
      where: { id: note.creditStudyId },
      data: { statusId: completedStudyStatus.id },
    });
  }

  private validateCustomer(customer: {
    email: string | null;
    businessName: string;
    identificationNumber: string;
    identificationTypeId: number | null;
    identificationType: { label: string } | null;
    address: string | null;
    phone: string | null;
  }): void {
    const customerFieldLabels: Record<string, string> = {
      email: 'correo electrónico',
      identificationType: 'tipo de identificación',
      address: 'dirección',
      phone: 'teléfono',
    };

    const missing: string[] = [];
    if (!customer.email) missing.push('email');
    if (!customer.identificationTypeId) missing.push('identificationType');
    if (!customer.address) missing.push('address');
    if (!customer.phone) missing.push('phone');

    if (missing.length > 0) {
      const missingLabels = missing
        .map((key) => customerFieldLabels[key])
        .join(', ');
      throw new BadRequestException(
        `Al cliente le faltan los siguientes datos obligatorios para generar el pagaré: ${missingLabels}.`,
      );
    }
  }

  private validateCompany(company: {
    name: string;
    address: string;
    city: string;
    accountTypeId: number | null;
    accountBankId: number | null;
    accountNumber: string | null;
    accountType: { label: string } | null;
    accountBank: { label: string } | null;
  }): void {
    const companyFieldLabels: Record<string, string> = {
      accountType: 'tipo de cuenta',
      accountBank: 'banco',
      accountNumber: 'número de cuenta',
    };

    const missing: string[] = [];
    if (!company.accountTypeId) missing.push('accountType');
    if (!company.accountBankId) missing.push('accountBank');
    if (!company.accountNumber) missing.push('accountNumber');

    if (missing.length > 0) {
      const missingLabels = missing
        .map((key) => companyFieldLabels[key])
        .join(', ');
      throw new BadRequestException(
        `La empresa no tiene configurada la información bancaria: ${missingLabels}.`,
      );
    }
  }

  private buildDocuSealValues(params: {
    promissoryNoteId: number;
    amount: number;
    amountInWords: string;
    customer: {
      businessName: string;
      email: string | null;
      identificationNumber: string;
      identificationType: { label: string } | null;
      address: string | null;
      phone: string | null;
    };
    company: {
      name: string;
      address: string;
      city: string;
      accountNumber: string | null;
      accountType: { label: string } | null;
      accountBank: { label: string } | null;
    };
  }): Record<string, string> {
    const now = new Date();
    const currentYear = now.getFullYear().toString();
    const currentMonth = SPANISH_MONTHS[now.getMonth()];
    const currentDay = now.getDate().toString();

    return {
      customerName: params.customer.businessName,
      promissoryId: params.promissoryNoteId.toString(),
      customerIdentificationType:
        params.customer.identificationType?.label ?? '',
      priceDescription: params.amountInWords,
      price: this.formatCOP(params.amount),
      paymentMethod: HARDCODED_PAYMENT_METHOD,
      paymentDay: HARDCODED_PAYMENT_DAY,
      paymentMonth: HARDCODED_PAYMENT_MONTH,
      paymentYear: HARDCODED_PAYMENT_YEAR,
      companyName: params.company.name,
      companyAddress: params.company.address,
      companyCity: params.company.city,
      accountType: params.company.accountType?.label ?? '',
      accountNumber: params.company.accountNumber ?? '',
      accountBank: params.company.accountBank?.label ?? '',
      currentYear,
      currentMonth,
      currentDay,
      customerIdentification: params.customer.identificationNumber,
      customerAddress: params.customer.address ?? '',
      customerPhoneNumber: params.customer.phone ?? '',
      customerEmail: params.customer.email ?? '',
    };
  }

  private formatCOP(amount: number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(amount);
  }
}
