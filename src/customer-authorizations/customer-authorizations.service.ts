import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CustomerAuthorizationsRepository } from './customer-authorizations.repository.js';
import { RequestAuthorizationDto } from './dto/request-authorization.dto.js';
import { ZapsignService } from '../documents/signing/zapsign.service.js';
import { SupabaseService } from '../auth/supabase.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ParametersRepository } from '../parameters/parameters.repository.js';
import {
  ZapsignWebhookPayload,
  extractDocToken,
} from '../documents/signing/dto/zapsign-webhook.dto.js';
import { CREDITIA_PARTY } from '../documents/macro-contract/creditia.constants.js';

/**
 * Orquesta la autorización del TITULAR CONSULTADO (documento único: tratamiento
 * de datos + habeas data + custodia) firmada vía Zapsign. Es el gate del bureau:
 * sin firma vigente no se puede consultar a un titular (ni crear su Customer ni
 * su CreditStudy).
 *
 * Se llavea por IDENTIDAD (companyId + identificationNumber), no por customerId,
 * porque el Customer nace de la consulta —que requiere esta firma—. El customerId
 * se rellena (backfill) tras la primera consulta exitosa.
 *
 * No confía en el payload del webhook: usa el doc token solo para ubicar la
 * autorización y re-consulta el estado real a Zapsign antes de marcar firmado.
 */
@Injectable()
export class CustomerAuthorizationsService {
  private readonly logger = new Logger(CustomerAuthorizationsService.name);
  private readonly templateId: string;
  private readonly storageBucket: string;
  private readonly logoUrl: string;
  private readonly creditia = CREDITIA_PARTY;
  /** Vigencia de la URL firmada del PDF en Storage (bucket privado). */
  private readonly signedUrlTtlSeconds = 3600;
  /** Finalidad del documento único (vs. 'disclosure', que va después). */
  private readonly CORE_TYPE_CODE = 'core';

  constructor(
    private readonly repository: CustomerAuthorizationsRepository,
    private readonly zapsign: ZapsignService,
    private readonly supabaseService: SupabaseService,
    private readonly prisma: PrismaService,
    private readonly parametersRepository: ParametersRepository,
    private readonly configService: ConfigService,
  ) {
    this.templateId =
      this.configService.get<string>('ZAPSIGN_CUSTOMER_AUTH_TEMPLATE_ID') ?? '';
    this.storageBucket =
      this.configService.get<string>(
        'SUPABASE_STORAGE_BUCKET_AUTHORIZATIONS',
      ) ?? 'customer-authorizations';
    this.logoUrl =
      this.configService.get<string>('LOGO_URL') ??
      'https://creditia.co/logo.png';
  }

  private async coreTypeId(): Promise<number> {
    const type = await this.repository.findParameterByTypeAndCode(
      'customer_authorization_type',
      this.CORE_TYPE_CODE,
    );
    if (!type) {
      throw new BadRequestException(
        "Falta el parámetro customer_authorization_type 'core'",
      );
    }
    return type.id;
  }

  private async statusId(code: string): Promise<number> {
    const status = await this.repository.findParameterByTypeAndCode(
      'customer_authorization_status',
      code,
    );
    if (!status) {
      throw new BadRequestException(
        `Falta el parámetro customer_authorization_status '${code}'`,
      );
    }
    return status.id;
  }

  /**
   * Solicita (o reenvía) la autorización del titular. Idempotente:
   *  - Ya firmada y vigente → no reenvía; devuelve el estado.
   *  - Pendiente de firma → no reenvía; devuelve el sign_url existente.
   *  - Rechazada o revocada → genera un documento nuevo REUTILIZANDO la fila
   *    (preserva la unicidad por identidad y permite reintentar).
   */
  async requestAuthorization(
    companyId: string,
    userId: string,
    dto: RequestAuthorizationDto,
  ) {
    if (!this.templateId) {
      throw new BadRequestException(
        'ZAPSIGN_CUSTOMER_AUTH_TEMPLATE_ID no configurado',
      );
    }

    const typeId = await this.coreTypeId();
    const existing = await this.repository.findByIdentity({
      companyId,
      identificationNumber: dto.identificationNumber,
      typeId,
    });

    // Ya firmada y no revocada → nada que hacer.
    if (existing?.signedAt && !existing.revokedAt) {
      return this.toStatusResponse(existing);
    }
    // Pendiente (enviada, sin firmar ni rechazar) → no reenviar, devolver la URL.
    if (existing && !existing.signedAt && !existing.refusedAt) {
      return this.toStatusResponse(existing);
    }

    // Tipo de identificación → Parameter (id para persistir, label para el doc).
    const identType = await this.parametersRepository.findByTypeAndCode(
      'identification_type',
      dto.identificationTypeCode.toLowerCase(),
    );
    if (!identType) {
      throw new BadRequestException(
        `Tipo de identificación '${dto.identificationTypeCode}' no encontrado en parámetros`,
      );
    }

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, nit: true },
    });
    if (!company) {
      throw new BadRequestException(`Empresa ${companyId} no encontrada`);
    }

    // Variables de la plantilla (ver docs/customer-authorization/variable-map.md).
    const data: Record<string, string> = {
      LOGO_URL: this.logoUrl,
      PROVEEDOR_NIT: this.creditia.nit,
      PROVEEDOR_CIUDAD: this.creditia.city,
      TITULAR_NOMBRE: dto.titularName,
      TITULAR_TIPO_DOC: identType.label,
      TITULAR_NUM_DOC: dto.identificationNumber,
      TITULAR_EMAIL: dto.titularEmail,
      EMPRESA_RAZON_SOCIAL: company.name,
      EMPRESA_NIT: company.nit,
    };

    // Crear el documento en Zapsign (envía la solicitud de firma al titular).
    const doc = await this.zapsign.createDocFromTemplate({
      templateId: this.templateId,
      signerName: dto.titularName,
      signerEmail: dto.titularEmail,
      data,
    });
    const signer =
      doc.signers.find(
        (s) => s.email?.toLowerCase() === dto.titularEmail.toLowerCase(),
      ) ?? doc.signers[0];

    const pendingStatusId = await this.statusId('pending');
    const commonData = {
      typeId,
      statusId: pendingStatusId,
      identificationTypeId: identType.id,
      titularName: dto.titularName,
      titularEmail: dto.titularEmail,
      templateId: this.templateId,
      zapsignDocToken: doc.docToken,
      signerToken: signer?.token ?? null,
      signUrl: signer?.sign_url ?? null,
      sentAt: new Date(),
    };

    let saved;
    if (existing) {
      // Rechazada/revocada → reutiliza la fila, limpia el estado anterior.
      saved = await this.repository.update(existing.id, {
        ...commonData,
        signedAt: null,
        signedDocumentUrl: null,
        signedFileStoragePath: null,
        refusedAt: null,
        refusedReason: null,
        revokedAt: null,
        revokedBy: null,
      });
    } else {
      saved = await this.repository.create({
        companyId,
        identificationNumber: dto.identificationNumber,
        createdBy: userId,
        ...commonData,
      });
    }

    this.logger.log(
      `Autorización ${existing ? 'reenviada' : 'creada'} para ${dto.identificationNumber} (empresa ${companyId}, doc=${doc.docToken})`,
    );
    return this.toStatusResponse({
      ...saved,
      status: { code: 'pending', label: 'Pendiente de firma' },
    });
  }

  /**
   * Estado de la autorización 'core' de una identidad, para el enrutamiento del
   * front. Devuelve status 'not_requested' si nunca se pidió.
   */
  async getStatus(companyId: string, identificationNumber: string) {
    const typeId = await this.coreTypeId();
    const auth = await this.repository.findByIdentity({
      companyId,
      identificationNumber,
      typeId,
    });
    if (!auth) {
      return {
        status: 'not_requested',
        isSigned: false,
        signUrl: null,
        sentAt: null,
        signedAt: null,
        refusedAt: null,
        refusedReason: null,
        revokedAt: null,
      };
    }
    return this.toStatusResponse(auth);
  }

  /**
   * GATE amable del from-bureau (no lanza error): resuelve la autorización 'core'
   * de un titular ANTES de consultar. Devuelve:
   *  - { authorized: true } si ya está firmada y vigente → se puede consultar.
   *  - { authorized: false, authorization } en cualquier otro caso, habiendo
   *    ENVIADO el documento de firma si hacía falta (finalidad: que el front
   *    muestre "pendiente de firma", no un error).
   *
   * Idempotente entre llamadas (incluso en días distintos):
   *  - Pendiente de firma → NO reenvía; devuelve el mismo estado/sign_url.
   *  - Rechazada / revocada / inexistente → (re)genera y envía el documento.
   */
  async resolveForConsult(
    companyId: string,
    userId: string,
    input: {
      identificationTypeCode: string;
      identificationNumber: string;
      titularName: string; // = razón social/apellido validado
      titularEmail: string;
    },
  ): Promise<{ authorized: boolean; authorization?: unknown }> {
    const typeId = await this.coreTypeId();
    const auth = await this.repository.findByIdentity({
      companyId,
      identificationNumber: input.identificationNumber,
      typeId,
    });

    // Ya firmada y vigente → se puede consultar.
    if (auth?.signedAt && !auth.revokedAt) return { authorized: true };

    // Pendiente de firma → mismo estado que la 1ª vez, sin reenviar el correo.
    if (auth && !auth.signedAt && !auth.refusedAt && !auth.revokedAt) {
      return { authorized: false, authorization: this.toStatusResponse(auth) };
    }

    // none / refused / revoked → genera y envía el documento (titularEmail es
    // requerido en el from-bureau, así que siempre hay a quién enviarlo).
    const authorization = await this.requestAuthorization(companyId, userId, {
      identificationTypeCode: input.identificationTypeCode,
      identificationNumber: input.identificationNumber,
      titularName: input.titularName,
      titularEmail: input.titularEmail,
    });
    return { authorized: false, authorization };
  }

  /**
   * GATE duro del bureau (safety net): exige una autorización 'core' FIRMADA y no
   * revocada. Lanza 403 si no la hay. El flujo normal (from-bureau) resuelve la
   * autorización antes con resolveForConsult, así que este gate solo dispara si
   * se llega a consult() por otra vía sin firma.
   */
  async ensureCanConsult(
    companyId: string,
    identificationNumber: string,
  ): Promise<void> {
    const typeId = await this.coreTypeId();
    const auth = await this.repository.findByIdentity({
      companyId,
      identificationNumber,
      typeId,
    });

    if (auth?.signedAt && !auth.revokedAt) return; // autorizado

    const authorizationStatus = !auth
      ? 'not_requested'
      : auth.revokedAt
        ? 'revoked'
        : auth.refusedAt
          ? 'refused'
          : 'pending';

    throw new ForbiddenException({
      code: 'CUSTOMER_AUTHORIZATION_REQUIRED',
      message:
        'El titular no ha firmado la autorización para ser consultado. ' +
        'Solicita/espera la firma antes de consultar la central de riesgo.',
      authorizationStatus,
      signUrl: auth?.signUrl ?? null,
    });
  }

  /**
   * Backfill: enlaza la autorización firmada con el Customer que nació de la
   * consulta. Best-effort, no rompe el flujo si falla.
   */
  async linkConsultedCustomer(
    companyId: string,
    identificationNumber: string,
    customerId: string,
  ): Promise<void> {
    try {
      await this.repository.linkCustomer({
        companyId,
        identificationNumber,
        customerId,
      });
    } catch (e) {
      this.logger.warn(
        `No se pudo enlazar el customer ${customerId} con su autorización: ${(e as Error).message}`,
      );
    }
  }

  /**
   * ¿Este doc token es una autorización del titular? Lo usa el despachador de
   * webhooks de Zapsign para enrutar el evento (Zapsign manda todos los eventos
   * de la cuenta a una sola URL; el token es el discriminador).
   */
  async ownsDocument(docToken: string): Promise<boolean> {
    return !!(await this.repository.findByDocToken(docToken));
  }

  /**
   * Webhook doc_signed: marca la autorización como firmada tras verificar el
   * estado real en Zapsign (no confía en el payload). Descarga el PDF a Storage
   * (respaldo best-effort). Idempotente.
   */
  async handleDocSigned(payload: ZapsignWebhookPayload): Promise<void> {
    const docToken = extractDocToken(payload);
    this.logger.log(
      `Webhook Zapsign doc_signed (autorización): doc=${docToken}, payloadStatus=${payload?.status}`,
    );
    if (!docToken) {
      this.logger.warn('Webhook doc_signed sin token de documento; ignorado');
      return;
    }

    const auth = await this.repository.findByDocToken(docToken);
    if (!auth) {
      this.logger.warn(
        `Autorización no encontrada para doc=${docToken}; ignorado`,
      );
      return;
    }
    if (auth.signedAt) {
      this.logger.log(`Autorización ${auth.id} ya estaba firmada; ignorado`);
      return;
    }

    const state = await this.zapsign.getDocState(docToken);
    if (state.status !== 'signed') {
      this.logger.log(
        `Autorización ${auth.id} aún no completa (status=${state.status}); se espera`,
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
          `${auth.companyId}/${auth.id}.pdf`,
          pdf,
          'application/pdf',
        );
      } catch (e) {
        this.logger.error(
          `No se pudo respaldar el PDF de la autorización ${auth.id}: ${(e as Error).message}`,
        );
      }
    }

    const signedStatusId = await this.statusId('signed');
    const claimed = await this.repository.markSigned({
      authorizationId: auth.id,
      signedStatusId,
      signedFileStoragePath: storagePath,
      signedDocumentUrl: state.signedFileUrl,
      signedAt: new Date(),
    });

    this.logger.log(
      claimed
        ? `Autorización ${auth.id} FIRMADA (empresa ${auth.companyId} ya puede consultar a ${auth.identificationNumber})`
        : `Autorización ${auth.id} ya había sido firmada (webhook concurrente)`,
    );
  }

  /**
   * Webhook doc_refused: el titular rechazó firmar. Marca 'refused' con el
   * motivo; la identidad NO queda autorizada. Idempotente y defensivo (verifica
   * contra Zapsign que el doc no esté en realidad firmado).
   */
  async handleDocRefused(payload: ZapsignWebhookPayload): Promise<void> {
    const docToken = extractDocToken(payload);
    this.logger.log(
      `Webhook Zapsign doc_refused (autorización): doc=${docToken}, motivo=${payload?.rejected_reason ?? '(sin motivo)'}`,
    );
    if (!docToken) return;

    const auth = await this.repository.findByDocToken(docToken);
    if (!auth) {
      this.logger.warn(
        `Autorización no encontrada para doc=${docToken}; ignorado`,
      );
      return;
    }
    if (auth.signedAt) {
      this.logger.warn(
        `Autorización ${auth.id} ya estaba firmada; se ignora doc_refused`,
      );
      return;
    }
    if (auth.refusedAt) {
      this.logger.log(`Autorización ${auth.id} ya estaba rechazada; ignorado`);
      return;
    }

    const state = await this.zapsign.getDocState(docToken);
    if (state.status === 'signed') {
      this.logger.warn(
        `doc_refused para ${auth.id} pero Zapsign dice signed; se ignora`,
      );
      return;
    }

    const refusedStatusId = await this.statusId('refused');
    await this.repository.update(auth.id, {
      statusId: refusedStatusId,
      refusedAt: new Date(),
      refusedReason: payload?.rejected_reason ?? null,
    });
    this.logger.log(`Autorización ${auth.id} marcada como RECHAZADA`);
  }

  /** Da forma al estado de la autorización para el front. */
  private toStatusResponse(auth: {
    id: string;
    signUrl: string | null;
    sentAt: Date | null;
    signedAt: Date | null;
    refusedAt: Date | null;
    refusedReason: string | null;
    revokedAt: Date | null;
    status?: { code: string; label: string } | null;
  }) {
    return {
      id: auth.id,
      status: auth.status?.code ?? null,
      statusLabel: auth.status?.label ?? null,
      isSigned: !!auth.signedAt && !auth.revokedAt,
      signUrl: auth.signUrl,
      sentAt: auth.sentAt,
      signedAt: auth.signedAt,
      refusedAt: auth.refusedAt,
      refusedReason: auth.refusedReason,
      revokedAt: auth.revokedAt,
    };
  }
}
