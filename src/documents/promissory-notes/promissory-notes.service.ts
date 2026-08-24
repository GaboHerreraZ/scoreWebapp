import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { bogotaDateParts, MESES_ES } from '../../common/utils/bogota-date.js';
import { MailService } from '../../mail/mail.service.js';
import { Prisma } from '../../../generated/prisma/client.js';

/**
 * Pagarés firmados por el CONSULTADO (deudor) vía el proveedor de firma
 * (Zapsign, capa compartida en SigningModule). Se emiten solo para estudios
 * viables ('approved' | 'conditional', nunca 'rejected'), con consecutivo único
 * por empresa y monto/plazo editables respecto a la solicitud (monto ≤ cupo
 * solicitado). El documento incluye el pagaré y la autorización para llenar
 * espacios en blanco (art. 622 C.Co.): un solo acto de firma que se estampa en
 * ambas secciones vía el ancla `<<...>>` de la plantilla.
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
  /**
   * Ancla `<<...>>` de la plantilla donde Zapsign estampa la firma. Va dos veces
   * en el documento (pagaré y autorización), así que la firma sale en ambas
   * páginas. Vacía = Zapsign la coloca solo al final.
   */
  private readonly signatureAnchor: string;
  /** Plantilla HTML del pagaré (fuente única: modelo Zapsign + preview). */
  private readonly templatePath = join(
    dirname(fileURLToPath(import.meta.url)),
    'templates',
    'pagare-template.html',
  );
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
    private readonly mailService: MailService,
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
    this.signatureAnchor =
      this.configService.get<string>(
        'ZAPSIGN_PROMISSORY_NOTE_SIGNATURE_ANCHOR',
      ) ?? '';
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

  /** Resuelve un identificationTypeId recibido en el body a su Parameter. */
  private async identificationTypeParam(id: number) {
    const param = await this.parametersRepository.findById(id);
    if (!param || param.type !== 'identification_type' || !param.isActive) {
      throw new BadRequestException(
        `identificationTypeId=${id} no es un tipo de identificación válido (Parameter tipo 'identification_type' activo)`,
      );
    }
    return param;
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
   * Carga el estudio y corre TODAS las validaciones de emisión (viabilidad,
   * tope de monto, unicidad por estudio, email del firmante, datos bancarios).
   * Compartido por preview() e issue() para que nunca diverjan.
   */
  private async resolveIssueContext(
    companyId: string,
    dto: CreatePromissoryNoteDto,
  ) {
    const study = await this.prisma.creditStudy.findFirst({
      where: { id: dto.creditStudyId, companyId },
      include: {
        customer: {
          include: {
            identificationType: true,
            personType: true,
            legalRepIdentificationType: true,
          },
        },
        company: {
          include: {
            accountType: true,
            accountBank: true,
            daneCity: {
              select: { name: true, region: { select: { name: true } } },
            },
          },
        },
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

    // ── El firmante: PN en nombre propio; PJ firma su representante legal ──
    // Los datos pueden venir en dto.signer (prellenado por el front con GET
    // .../customers/:id/legal-representative); lo no enviado cae al Customer.
    const rawCustomer = study.customer;
    const isPJ = rawCustomer.personType.code === 'legalEntity';
    const s = dto.signer;

    let signerName: string;
    let signerEmail: string;
    let firmante: {
      nombre: string;
      tipoDoc: string;
      numDoc: string;
      actuacion: string;
      lineaRepresentante: string;
    };
    let customer: typeof rawCustomer = rawCustomer;

    if (isPJ) {
      const repName = s?.legalRepName ?? rawCustomer.legalRepName;
      const repIdTypeId =
        s?.legalRepIdentificationTypeId ??
        rawCustomer.legalRepIdentificationTypeId;
      const repIdNumber =
        s?.legalRepIdentificationNumber ??
        rawCustomer.legalRepIdentificationNumber;
      const repEmail = s?.legalRepEmail ?? rawCustomer.legalRepEmail;

      const missingRep: string[] = [];
      if (!repName) missingRep.push('nombre');
      if (repIdTypeId == null) missingRep.push('tipo de identificación');
      if (!repIdNumber) missingRep.push('número de identificación');
      if (!repEmail) missingRep.push('correo');
      if (missingRep.length > 0) {
        throw new BadRequestException(
          `Para emitir el pagaré de una persona jurídica se requieren los datos del representante legal, que es quien lo firma (falta: ${missingRep.join(', ')}). Envíalos en el campo signer de la petición.`,
        );
      }

      const repIdTypeLabel =
        s?.legalRepIdentificationTypeId != null
          ? (await this.identificationTypeParam(s.legalRepIdentificationTypeId))
              .label
          : rawCustomer.legalRepIdentificationType!.label;

      signerName = repName!;
      signerEmail = repEmail!;
      const nitConDv = rawCustomer.verificationDigit
        ? `${rawCustomer.identificationNumber}-${rawCustomer.verificationDigit}`
        : rawCustomer.identificationNumber;
      firmante = {
        nombre: repName!,
        tipoDoc: repIdTypeLabel,
        numDoc: repIdNumber!,
        actuacion: `actuando en calidad de representante legal de ${rawCustomer.businessName}, identificada con NIT ${nitConDv}`,
        lineaRepresentante: `Representante legal: ${repName} · ${repIdTypeLabel} No. ${repIdNumber}`,
      };
    } else {
      const email = s?.email ?? rawCustomer.email;
      if (!email) {
        throw new BadRequestException(
          'El cliente no tiene correo registrado; es necesario para enviarle el pagaré a firma. Envíalo en el campo signer de la petición.',
        );
      }
      const nameFromParts = [
        s?.firstName,
        s?.secondName,
        s?.firstLastName,
        s?.secondLastName,
      ]
        .filter(Boolean)
        .join(' ');
      const idType =
        s?.identificationTypeId != null
          ? await this.identificationTypeParam(s.identificationTypeId)
          : rawCustomer.identificationType;
      const numDoc =
        s?.identificationNumber ?? rawCustomer.identificationNumber;

      signerName = nameFromParts || rawCustomer.businessName;
      signerEmail = email;
      firmante = {
        nombre: signerName,
        tipoDoc: idType?.label ?? 'Documento',
        numDoc,
        actuacion: 'actuando en nombre propio',
        lineaRepresentante: '',
      };
      // PN: deudor y firmante son la misma persona → los DEUDOR_* del documento
      // reflejan lo recibido en el body.
      customer = {
        ...rawCustomer,
        businessName: signerName,
        identificationNumber: numDoc,
        identificationType: idType,
        email,
        phone: s?.phone ?? rawCustomer.phone,
      };
    }

    // ── Datos bancarios del acreedor: los exige el texto del pagaré ──
    const company = study.company;
    const missingBank: string[] = [];
    if (!company.accountType) missingBank.push('tipo de cuenta');
    if (!company.accountNumber) missingBank.push('número de cuenta');
    if (!company.accountBank) missingBank.push('banco');
    if (missingBank.length > 0) {
      throw new BadRequestException(
        `Para emitir el pagaré es necesario completar los datos bancarios de la empresa (falta: ${missingBank.join(', ')}). Puedes registrarlos en Administración → Empresa → Datos financieros.`,
      );
    }

    const issuedAt = new Date();
    const dueDate = new Date(
      issuedAt.getTime() + dto.termDays * 24 * 60 * 60 * 1000,
    );
    const amount = Math.round(dto.amount);
    const amountInWords = numberToSpanishWords(amount);

    return {
      study,
      customer,
      company,
      signerName,
      signerEmail,
      firmante,
      issuedAt,
      dueDate,
      amount,
      amountInWords,
    };
  }

  /**
   * Variables {{...}} del documento, compartidas por el modelo de Zapsign
   * (issue → createDocFromTemplate) y el preview (render del HTML local). Una
   * sola función para que el preview y el documento real nunca diverjan.
   */
  private buildTemplateData(
    ctx: {
      customer: {
        businessName: string;
        identificationNumber: string;
        verificationDigit: string | null;
        address: string | null;
        phone: string | null;
        identificationType: { label: string } | null;
      };
      company: {
        name: string;
        nit: string;
        address: string;
        daneCity: { name: string };
        accountNumber: string | null;
        accountType: { label: string } | null;
        accountBank: { label: string } | null;
      };
      signerEmail: string;
      // Quien suscribe: el deudor (PN) o su representante legal (PJ).
      firmante: {
        nombre: string;
        tipoDoc: string;
        numDoc: string;
        actuacion: string;
        lineaRepresentante: string;
      };
      issuedAt: Date;
    },
    noteNumber: number,
  ): Record<string, string> {
    const { customer, company, signerEmail, firmante, issuedAt } = ctx;
    const firma = bogotaDateParts(issuedAt);
    return {
      LOGO_URL: this.logoUrl,
      NOTE_NUMBER: String(noteNumber),
      DEUDOR_NOMBRE: customer.businessName,
      DEUDOR_TIPO_DOC: customer.identificationType?.label ?? 'Documento',
      // PJ: NIT con dígito de verificación (900123456-7).
      DEUDOR_NUM_DOC: customer.verificationDigit
        ? `${customer.identificationNumber}-${customer.verificationDigit}`
        : customer.identificationNumber,
      FIRMANTE_NOMBRE: firmante.nombre,
      FIRMANTE_TIPO_DOC: firmante.tipoDoc,
      FIRMANTE_NUM_DOC: firmante.numDoc,
      FIRMANTE_ACTUACION: firmante.actuacion,
      FIRMANTE_LINEA_REP: firmante.lineaRepresentante,
      DEUDOR_DIRECCION: customer.address ?? '—',
      DEUDOR_TELEFONO: customer.phone ?? '—',
      DEUDOR_EMAIL: signerEmail,
      ACREEDOR_RAZON_SOCIAL: company.name,
      ACREEDOR_NIT: company.nit,
      ACREEDOR_DIRECCION: company.address,
      ACREEDOR_CIUDAD: company.daneCity.name,
      ACREEDOR_TIPO_CUENTA: company.accountType?.label ?? '',
      ACREEDOR_NUM_CUENTA: company.accountNumber ?? '',
      ACREEDOR_BANCO: company.accountBank?.label ?? '',
      FORMA_PAGO: 'un solo pago',
      FIRMA_CIUDAD: company.daneCity.name,
      FIRMA_DIA: String(firma.day),
      FIRMA_MES: firma.monthName,
      FIRMA_ANIO: String(firma.year),
    };
  }

  /**
   * Vista previa del pagaré: corre las MISMAS validaciones que issue() y
   * devuelve la plantilla HTML del documento ya rellenada, SIN crear nada, sin
   * tocar el proveedor de firma y sin enviar correos. El front la muestra tal
   * cual (iframe/dialog) para que el usuario confirme antes de emitir.
   */
  async preview(companyId: string, dto: CreatePromissoryNoteDto) {
    const ctx = await this.resolveIssueContext(companyId, dto);

    // Tentativo: el definitivo se reserva al emitir (una emisión concurrente
    // podría tomarlo primero).
    const noteNumber = await this.repository.nextNoteNumber(companyId);

    const data = this.buildTemplateData(ctx, noteNumber);
    let html = readFileSync(this.templatePath, 'utf-8');
    for (const [key, value] of Object.entries(data)) {
      html = html.replaceAll(`{{${key}}}`, value);
    }

    return {
      noteNumber, // tentativo
      requestedCreditLine: ctx.study.requestedCreditLine, // tope del monto editable
      html,
    };
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

    const {
      study,
      customer,
      company,
      signerName,
      signerEmail,
      firmante,
      issuedAt,
      dueDate,
      amount,
      amountInWords,
    } = await this.resolveIssueContext(companyId, dto);

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
          signCity: company.daneCity.name,
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
    let note: Awaited<ReturnType<PromissoryNotesRepository['update']>>;
    try {
      const doc = await this.zapsign.createDocFromTemplate({
        templateId: this.templateId,
        signerName,
        signerEmail,
        signaturePlacementAnchor: this.signatureAnchor || undefined,
        data: this.buildTemplateData(
          { customer, company, signerEmail, firmante, issuedAt },
          created.noteNumber,
        ),
      });
      const signer =
        doc.signers.find(
          (s) => s.email?.toLowerCase() === signerEmail.toLowerCase(),
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
      `El pagaré #${created.noteNumber} fue enviado a ${signerEmail} para firma.`,
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
    const note = await this.repository.findRawById(id, companyId);
    if (!note) {
      throw new NotFoundException(
        `No se encontró el pagaré con id=${id} en esta empresa.`,
      );
    }
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
    const note = await this.repository.findRawById(id, companyId);
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

  /**
   * Recordatorio de pago del pagaré: un correo al deudor (valor, vencimiento y
   * cuenta del acreedor para pagar) y otro a los administradores de la empresa
   * confirmando el envío. Solo aplica a pagarés FIRMADOS con vencimiento.
   */
  async sendPaymentReminder(id: number, companyId: string) {
    const note = await this.findById(id, companyId);

    if (note.status.code !== 'signed') {
      throw new BadRequestException(
        'Solo se puede enviar el recordatorio de pago de pagarés firmados.',
      );
    }
    if (!note.dueDate) {
      throw new BadRequestException(
        'El pagaré no tiene fecha de vencimiento registrada.',
      );
    }

    const to = note.customer.email ?? note.customer.legalRepEmail;
    if (!to) {
      throw new BadRequestException(
        'El cliente no tiene correo registrado para enviarle el recordatorio.',
      );
    }

    // dueDate es @db.Date (medianoche UTC): se formatea con partes UTC para no
    // correrse un día al aplicar zona horaria.
    const dueDateText = `${note.dueDate.getUTCDate()} de ${MESES_ES[note.dueDate.getUTCMonth()]} de ${note.dueDate.getUTCFullYear()}`;
    const todayBogota = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bogota',
    }).format(new Date());
    const isOverdue = note.dueDate.toISOString().slice(0, 10) < todayBogota;
    const dueLabel = isOverdue
      ? `<strong>venció el ${dueDateText}</strong>`
      : `vence el <strong>${dueDateText}</strong>`;
    const amount = formatCOP(note.amount);

    await this.mailService.sendPromissoryReminderClientEmail({
      to,
      customerName: note.customer.businessName,
      companyName: note.company.name,
      noteNumber: String(note.noteNumber),
      amount,
      dueLabel,
      dueDateText,
      creditorBank: note.creditorBank ?? '—',
      creditorAccountType: note.creditorAccountType ?? 'Cuenta',
      creditorAccountNumber: note.creditorAccountNumber ?? '—',
    });

    // Confirmación a los admins de la empresa (best-effort: el recordatorio al
    // deudor ya salió; un fallo aquí no debe tumbar la petición).
    let adminsNotified = 0;
    try {
      const admins = await this.repository.findCompanyAdmins(companyId);
      const results = await Promise.allSettled(
        admins.map((admin) =>
          this.mailService.sendPromissoryReminderAdminEmail({
            to: admin.email,
            adminName:
              [admin.name, admin.lastName].filter(Boolean).join(' ') ||
              'Administrador',
            companyName: note.company.name,
            customerName: note.customer.businessName,
            customerEmail: to,
            noteNumber: String(note.noteNumber),
            amount,
            dueDateText,
          }),
        ),
      );
      adminsNotified = results.filter((r) => r.status === 'fulfilled').length;
      for (const r of results) {
        if (r.status === 'rejected') {
          this.logger.error(
            `No se pudo notificar a un admin el recordatorio del pagaré ${id}: ${(r.reason as Error)?.message}`,
          );
        }
      }
    } catch (e) {
      this.logger.error(
        `No se pudo notificar a los admins el recordatorio del pagaré ${id}: ${(e as Error).message}`,
      );
    }

    this.logger.log(
      `Recordatorio de pago del pagaré #${note.noteNumber} (id=${id}) enviado a ${to} (admins notificados: ${adminsNotified})`,
    );

    return {
      message: 'Recordatorio de pago enviado.',
      sentTo: to,
      adminsNotified,
      dueDate: note.dueDate,
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
