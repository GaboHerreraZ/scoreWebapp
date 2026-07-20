import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PromissoryNotesRepository } from './promissory-notes.repository.js';
import { ParametersRepository } from '../../parameters/parameters.repository.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { ZapsignService } from '../signing/zapsign.service.js';
import { SupabaseService } from '../../auth/supabase.service.js';
import {
  ZapsignWebhookPayload,
  extractDocToken,
} from '../signing/dto/zapsign-webhook.dto.js';
import { CreatePromissoryNoteDto } from './dto/create-promissory-note.dto.js';
import { numberToSpanishWords } from '../../common/utils/number-to-words.js';
import { formatCOP } from '../../common/utils/currency.js';
import { bogotaDateParts } from '../../common/utils/bogota-date.js';
import { Prisma } from '../../../generated/prisma/client.js';

/**
 * Pagarés firmados por el CONSULTADO (deudor) vía el proveedor de firma
 * (Zapsign, capa compartida en SigningModule). Se emiten solo para estudios
 * viables ('approved' | 'conditional', nunca 'rejected'), con consecutivo único
 * por empresa y monto/plazo editables respecto a la solicitud (monto ≤ cupo
 * solicitado). El documento incluye el pagaré y la autorización para llenar
 * espacios en blanco (art. 622 C.Co.) — una sola firma cubre ambas secciones.
 *
 * Ciclo del estudio: studyCompleted → pendingSignature (al emitir) → closed (al
 * firmarse) o de vuelta a studyCompleted (si se declina/rechaza).
 */
@Injectable()
export class PromissoryNotesService {
  private readonly logger = new Logger(PromissoryNotesService.name);
  private readonly templateId: string;
  private readonly storageBucket: string;
  private readonly logoUrl: string;
  /** Vigencia de la URL firmada del PDF en Storage (bucket privado). */
  private readonly signedUrlTtlSeconds = 3600;

  constructor(
    private readonly repository: PromissoryNotesRepository,
    private readonly prisma: PrismaService,
    private readonly parametersRepository: ParametersRepository,
    private readonly notificationsService: NotificationsService,
    private readonly zapsign: ZapsignService,
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {
    this.templateId =
      this.configService.get<string>('ZAPSIGN_PROMISSORY_NOTE_TEMPLATE_ID') ??
      '';
    this.storageBucket =
      this.configService.get<string>(
        'SUPABASE_STORAGE_BUCKET_PROMISSORY_NOTES',
      ) ?? 'promissory-notes';
    this.logoUrl =
      this.configService.get<string>('LOGO_URL') ??
      'https://creditia.co/logo.png';
  }

  private async noteStatusId(code: string): Promise<number> {
    const status = await this.parametersRepository.findByTypeAndCode(
      'promissory_note_status',
      code,
    );
    if (!status) {
      throw new BadRequestException(
        `Falta el parámetro promissory_note_status '${code}'`,
      );
    }
    return status.id;
  }

  private async creditStatusId(code: string): Promise<number> {
    const status = await this.parametersRepository.findByTypeAndCode(
      'credit_status',
      code,
    );
    if (!status) {
      throw new BadRequestException(
        `Falta el parámetro credit_status '${code}'`,
      );
    }
    return status.id;
  }

  private async setStudyStatus(
    creditStudyId: string,
    code: string,
  ): Promise<void> {
    const statusId = await this.creditStatusId(code);
    await this.prisma.creditStudy.update({
      where: { id: creditStudyId },
      data: { statusId },
    });
  }

  /**
   * Emite el pagaré de un estudio viable y lo envía a firma del consultado.
   * Reserva el consecutivo por empresa ANTES de crear el documento (el número
   * va impreso en el texto); si el proveedor de firma falla, la fila se elimina.
   */
  async issue(companyId: string, userId: string, dto: CreatePromissoryNoteDto) {
    if (!this.templateId) {
      throw new BadRequestException(
        'ZAPSIGN_PROMISSORY_NOTE_TEMPLATE_ID no configurado',
      );
    }

    const study = await this.prisma.creditStudy.findFirst({
      where: { id: dto.creditStudyId, companyId },
      include: {
        customer: { include: { identificationType: true } },
        company: { include: { accountType: true, accountBank: true } },
      },
    });
    if (!study) {
      throw new NotFoundException(
        `No se encontró el estudio de crédito ${dto.creditStudyId} en esta empresa.`,
      );
    }

    // ── Gate de viabilidad: solo viable o viable con condiciones ──
    if (
      study.viabilityStatus !== 'approved' &&
      study.viabilityStatus !== 'conditional'
    ) {
      throw new BadRequestException(
        'Solo se puede emitir pagaré para estudios viables o viables con condiciones.',
      );
    }

    // ── El monto es editable pero no puede superar el cupo solicitado ──
    if (
      study.requestedCreditLine != null &&
      dto.amount > study.requestedCreditLine
    ) {
      throw new BadRequestException(
        `El monto del pagaré (${formatCOP(dto.amount)}) no puede superar el cupo solicitado en el estudio (${formatCOP(study.requestedCreditLine)}).`,
      );
    }

    // ── Un solo pagaré activo (pendiente o firmado) por estudio ──
    const active = await this.repository.countActiveByCreditStudy(study.id);
    if (active > 0) {
      throw new ConflictException(
        'Este estudio ya tiene un pagaré pendiente de firma o firmado. Declínalo antes de emitir uno nuevo.',
      );
    }

    // ── El firmante es el consultado: necesita email ──
    const customer = study.customer;
    if (!customer.email) {
      throw new BadRequestException(
        'El cliente no tiene correo registrado; es necesario para enviarle el pagaré a firma.',
      );
    }

    // ── Datos bancarios del acreedor: los exige el texto del pagaré ──
    const company = study.company;
    const missingBank: string[] = [];
    if (!company.accountType) missingBank.push('tipo de cuenta');
    if (!company.accountNumber) missingBank.push('número de cuenta');
    if (!company.accountBank) missingBank.push('banco');
    if (missingBank.length > 0) {
      throw new BadRequestException(
        `Completa los datos bancarios de la empresa antes de emitir el pagaré: falta ${missingBank.join(', ')}.`,
      );
    }

    const issuedAt = new Date();
    const dueDate = new Date(
      issuedAt.getTime() + dto.termDays * 24 * 60 * 60 * 1000,
    );
    const amount = Math.round(dto.amount);
    const amountInWords = numberToSpanishWords(amount);

    const pendingStatusId = await this.noteStatusId('pendingSignature');

    // 1. Reservar el consecutivo creando la fila (retry ante emisión concurrente:
    //    el unique (companyId, noteNumber) hace fallar al perdedor con P2002).
    let created = null as Awaited<
      ReturnType<PromissoryNotesRepository['create']>
    > | null;
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      const noteNumber = await this.repository.nextNoteNumber(companyId);
      try {
        created = await this.repository.create({
          companyId,
          creditStudyId: study.id,
          customerId: customer.id,
          createdBy: userId,
          statusId: pendingStatusId,
          noteNumber,
          amount,
          amountInWords,
          termDays: dto.termDays,
          dueDate,
          signCity: company.city,
          creditorAddress: company.address,
          creditorAccountType: company.accountType?.label ?? null,
          creditorAccountNumber: company.accountNumber,
          creditorBank: company.accountBank?.label ?? null,
          templateId: this.templateId,
        });
      } catch (e) {
        const isNoteNumberClash =
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002';
        if (!isNoteNumberClash) throw e;
      }
    }
    if (!created) {
      throw new ConflictException(
        'No se pudo asignar el consecutivo del pagaré; intenta de nuevo.',
      );
    }

    // 2. Crear el documento en el proveedor de firma (envía el email al deudor).
    //    Si falla, se libera el consecutivo eliminando la fila.
    const firma = bogotaDateParts(issuedAt);
    const pago = bogotaDateParts(dueDate);
    let note: Awaited<ReturnType<PromissoryNotesRepository['update']>>;
    try {
      const doc = await this.zapsign.createDocFromTemplate({
        templateId: this.templateId,
        signerName: customer.businessName,
        signerEmail: customer.email,
        data: {
          LOGO_URL: this.logoUrl,
          NOTE_NUMBER: String(created.noteNumber),
          DEUDOR_NOMBRE: customer.businessName,
          DEUDOR_TIPO_DOC: customer.identificationType?.label ?? 'Documento',
          DEUDOR_NUM_DOC: customer.identificationNumber,
          DEUDOR_DIRECCION: customer.address ?? '—',
          DEUDOR_TELEFONO: customer.phone ?? '—',
          DEUDOR_EMAIL: customer.email,
          ACREEDOR_RAZON_SOCIAL: company.name,
          ACREEDOR_NIT: company.nit,
          ACREEDOR_DIRECCION: company.address,
          ACREEDOR_CIUDAD: company.city,
          ACREEDOR_TIPO_CUENTA: company.accountType?.label ?? '',
          ACREEDOR_NUM_CUENTA: company.accountNumber ?? '',
          ACREEDOR_BANCO: company.accountBank?.label ?? '',
          MONTO_LETRAS: amountInWords,
          MONTO_NUMERO: formatCOP(amount),
          FORMA_PAGO: 'un solo pago',
          PAGO_DIA: String(pago.day),
          PAGO_MES: pago.monthName,
          PAGO_ANIO: String(pago.year),
          FIRMA_CIUDAD: company.city,
          FIRMA_DIA: String(firma.day),
          FIRMA_MES: firma.monthName,
          FIRMA_ANIO: String(firma.year),
        },
      });
      const signer =
        doc.signers.find(
          (s) => s.email?.toLowerCase() === customer.email?.toLowerCase(),
        ) ?? doc.signers[0];

      note = await this.repository.update(created.id, {
        providerDocToken: doc.docToken,
        signerToken: signer?.token ?? null,
        signingUrl: signer?.sign_url ?? null,
        sentAt: new Date(),
      });
    } catch (e) {
      await this.repository.delete(created.id).catch(() => {});
      throw e;
    }

    // 3. El estudio queda esperando la firma.
    await this.setStudyStatus(study.id, 'pendingSignature');

    this.emitNotification(
      userId,
      companyId,
      'Pagaré enviado a firma',
      `El pagaré #${created.noteNumber} fue enviado a ${customer.email} para firma.`,
      `/app/credit-study/detail/${study.id}`,
    );
    this.logger.log(
      `Pagaré #${created.noteNumber} (id=${created.id}) emitido para el estudio ${study.id} (empresa ${companyId})`,
    );
    return note;
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

  /**
   * URL del PDF firmado: primero el respaldo en Storage (URL firmada temporal);
   * si aún no hay respaldo, se pide una URL fresca al proveedor de firma.
   */
  async getSignedDocumentUrl(id: number, companyId: string): Promise<string> {
    const note = await this.findById(id, companyId);
    if (!note.signedAt) {
      throw new BadRequestException('El pagaré aún no ha sido firmado.');
    }

    if (note.signedFileStoragePath) {
      return this.supabaseService.createSignedUrl(
        this.storageBucket,
        note.signedFileStoragePath,
        this.signedUrlTtlSeconds,
      );
    }

    if (note.providerDocToken) {
      this.logger.warn(
        `Pagaré ${id} sin respaldo en Storage; se sirve desde el proveedor de firma`,
      );
      const state = await this.zapsign.getDocState(note.providerDocToken);
      if (state.signedFileUrl) return state.signedFileUrl;
    }
    throw new NotFoundException(
      'El PDF firmado del pagaré no está disponible todavía.',
    );
  }

  /**
   * Declines (cancels) a promissory note that is pending signature: marks it
   * as DECLINED and reverts the credit study status back to `estudioRealizado`
   * so a new document can be sent.
   */
  async decline(id: number, companyId: string) {
    const note = await this.repository.findById(id, companyId);
    if (!note) {
      throw new NotFoundException(
        `No se encontró el pagaré con id=${id} en esta empresa.`,
      );
    }

    // Only pending notes can be declined
    const pendingStatusId = await this.noteStatusId('pendingSignature');
    if (note.statusId !== pendingStatusId) {
      throw new BadRequestException(
        'Solo se pueden declinar pagarés que estén pendientes de firma.',
      );
    }

    const updated = await this.markDeclined(note.id, note.creditStudyId, null);

    this.emitNotification(
      note.createdBy,
      companyId,
      `Pagaré declinado`,
      `El pagaré #${note.noteNumber} fue declinado.`,
      `/app/credit-study/detail/${note.creditStudyId}`,
    );

    return updated;
  }

  /** Marca DECLINED y devuelve el estudio a estudioRealizado (reutilizable). */
  private async markDeclined(
    noteId: number,
    creditStudyId: string,
    refusedReason: string | null,
  ) {
    const declinedStatusId = await this.noteStatusId('declined');
    const updated = await this.repository.update(noteId, {
      statusId: declinedStatusId,
      declinedAt: new Date(),
      refusedReason,
    });
    await this.setStudyStatus(creditStudyId, 'studyCompleted');
    return updated;
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

  // ─── Webhooks del proveedor de firma (via despachador único) ───────────────

  /**
   * ¿Este doc token es un pagaré? Lo usa el despachador de webhooks para
   * enrutar el evento (el proveedor manda todos los eventos de la cuenta a una
   * sola URL; el token es el discriminador).
   */
  async ownsDocument(docToken: string): Promise<boolean> {
    return !!(await this.repository.findByDocToken(docToken));
  }

  /**
   * Webhook doc_signed: marca el pagaré como firmado tras verificar el estado
   * real en el proveedor (no confía en el payload), respalda el PDF en Storage
   * (best-effort) y CIERRA el estudio de crédito. Idempotente.
   */
  async handleDocSigned(payload: ZapsignWebhookPayload): Promise<void> {
    const docToken = extractDocToken(payload);
    this.logger.log(
      `Webhook doc_signed (pagaré): doc=${docToken}, payloadStatus=${payload?.status}`,
    );
    if (!docToken) return;

    const note = await this.repository.findByDocToken(docToken);
    if (!note) {
      this.logger.warn(`Pagaré no encontrado para doc=${docToken}; ignorado`);
      return;
    }
    if (note.signedAt) {
      this.logger.log(`Pagaré ${note.id} ya estaba firmado; ignorado`);
      return;
    }

    const state = await this.zapsign.getDocState(docToken);
    if (state.status !== 'signed') {
      this.logger.log(
        `Pagaré ${note.id} aún no completo (status=${state.status}); se espera`,
      );
      return;
    }

    // Respaldo del PDF firmado en Storage (best-effort).
    let storagePath: string | null = null;
    if (state.signedFileUrl) {
      try {
        const pdf = await this.zapsign.downloadDocument(state.signedFileUrl);
        storagePath = await this.supabaseService.uploadFile(
          this.storageBucket,
          `${note.companyId}/pagare-${note.noteNumber}-${note.id}.pdf`,
          pdf,
          'application/pdf',
        );
      } catch (e) {
        this.logger.error(
          `No se pudo respaldar el PDF del pagaré ${note.id}: ${(e as Error).message}`,
        );
      }
    }

    const signedStatusId = await this.noteStatusId('signed');
    const claimed = await this.repository.markSigned({
      id: note.id,
      signedStatusId,
      signedFileStoragePath: storagePath,
      signedDocumentUrl: state.signedFileUrl,
      signedAt: new Date(),
    });
    if (!claimed) {
      this.logger.log(
        `Pagaré ${note.id} ya había sido firmado (webhook concurrente)`,
      );
      return;
    }

    // El ciclo del estudio termina: firmado ⇒ cerrado.
    await this.setStudyStatus(note.creditStudyId, 'closed');

    this.emitNotification(
      note.createdBy,
      note.companyId,
      'Pagaré firmado',
      `El pagaré #${note.noteNumber} fue firmado por el deudor. El estudio quedó cerrado.`,
      `/app/credit-study/detail/${note.creditStudyId}`,
    );
    this.logger.log(
      `Pagaré ${note.id} FIRMADO; estudio ${note.creditStudyId} cerrado`,
    );
  }

  /**
   * Webhook doc_refused: el deudor rechazó firmar. Marca DECLINED con el motivo
   * y devuelve el estudio a estudioRealizado para poder reemitir. Idempotente y
   * defensivo (verifica contra el proveedor que el doc no esté firmado).
   */
  async handleDocRefused(payload: ZapsignWebhookPayload): Promise<void> {
    const docToken = extractDocToken(payload);
    this.logger.log(
      `Webhook doc_refused (pagaré): doc=${docToken}, motivo=${payload?.rejected_reason ?? '(sin motivo)'}`,
    );
    if (!docToken) return;

    const note = await this.repository.findByDocToken(docToken);
    if (!note) {
      this.logger.warn(`Pagaré no encontrado para doc=${docToken}; ignorado`);
      return;
    }
    if (note.signedAt) {
      this.logger.warn(
        `Pagaré ${note.id} ya estaba firmado; se ignora doc_refused`,
      );
      return;
    }
    if (note.declinedAt) {
      this.logger.log(`Pagaré ${note.id} ya estaba declinado; ignorado`);
      return;
    }

    const state = await this.zapsign.getDocState(docToken);
    if (state.status === 'signed') {
      this.logger.warn(
        `doc_refused para el pagaré ${note.id} pero el proveedor dice signed; se ignora`,
      );
      return;
    }

    await this.markDeclined(
      note.id,
      note.creditStudyId,
      payload?.rejected_reason ?? null,
    );
    this.emitNotification(
      note.createdBy,
      note.companyId,
      'Pagaré rechazado',
      `El deudor rechazó firmar el pagaré #${note.noteNumber}. El estudio volvió a estudio realizado.`,
      `/app/credit-study/detail/${note.creditStudyId}`,
    );
    this.logger.log(`Pagaré ${note.id} marcado como DECLINADO (rechazo)`);
  }

  private emitNotification(
    userId: string,
    companyId: string,
    title: string,
    message: string,
    route: string,
  ): void {
    this.parametersRepository
      .findByTypeAndCode('notification_type', 'promissory_note')
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
}
