import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MacroContractRepository } from './macro-contract.repository.js';
import { ZapsignService } from '../signing/zapsign.service.js';
import { SupabaseService } from '../../auth/supabase.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  ZapsignWebhookPayload,
  extractDocToken,
} from '../signing/dto/zapsign-webhook.dto.js';
import { CREDITIA_PARTY } from './creditia.constants.js';

/**
 * Orquesta el contrato macro Creditia ↔ empresa cliente:
 *  1. sendContractForCompany(): al confirmarse el primer pago, genera el
 *     documento desde la plantilla con los datos de la empresa, firma la parte
 *     de Creditia por API y deja al cliente el sign_url. Deja el contrato en
 *     estado 'pending_contract' (la cuenta NO se activa aún).
 *  2. handleWebhook(): cuando llega doc_signed, re-consulta el estado real a
 *     Zapsign; si status='signed' (todos firmaron), descarga el PDF a Supabase
 *     Storage (respaldo) y ACTIVA la cuenta de la empresa.
 */
@Injectable()
export class MacroContractService {
  private readonly logger = new Logger(MacroContractService.name);
  private readonly templateId: string;
  private readonly storageBucket: string;
  private readonly creditia = CREDITIA_PARTY;
  private readonly logoUrl: string;
  /** Vigencia de la URL firmada del PDF en Storage (bucket privado). */
  private readonly signedUrlTtlSeconds = 3600;

  constructor(
    private readonly repository: MacroContractRepository,
    private readonly zapsign: ZapsignService,
    private readonly supabaseService: SupabaseService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.templateId =
      this.configService.get<string>('ZAPSIGN_MACRO_TEMPLATE_ID') ?? '';
    this.storageBucket =
      this.configService.get<string>('SUPABASE_STORAGE_BUCKET_CONTRACTS') ??
      'macro-contracts';
    this.logoUrl =
      this.configService.get<string>('LOGO_URL') ??
      'https://creditia.co/logo.png';
  }

  /**
   * Envía el contrato macro a una empresa. Uno por empresa (companyId único):
   *  - Si ya hay un contrato pendiente o firmado, NO reenvía (idempotente).
   *  - Si el contrato anterior fue RECHAZADO, genera uno nuevo en Zapsign y
   *    REUTILIZA el mismo registro (preserva "uno por empresa" y permite
   *    reintentar tras corregir datos con el cliente).
   * Best-effort desde el webhook de pago: un fallo aquí no debe romper la
   * confirmación del pago (el llamador lo envuelve en try/catch).
   */
  async sendContractForCompany(companyId: string): Promise<void> {
    const existing = await this.repository.findByCompanyId(companyId);
    if (existing && !existing.refusedAt) {
      // Pendiente o firmado → no reenviar.
      this.logger.log(
        `La empresa ${companyId} ya tiene contrato macro activo (${existing.zapsignDocToken}); no se reenvía`,
      );
      return;
    }
    // Si llegamos aquí con `existing`, estaba rechazado → se reintentará
    // reutilizando el registro (existing.id) al final.

    if (!this.templateId) {
      throw new BadRequestException('ZAPSIGN_MACRO_TEMPLATE_ID no configurado');
    }

    // Datos de la empresa + su admin (dueño que hizo el onboarding) = firmante.
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: {
        userCompanies: {
          where: { isActive: true },
          orderBy: { joinedAt: 'asc' },
          take: 1,
          include: {
            user: { include: { identificationType: true } },
          },
        },
      },
    });
    if (!company) {
      throw new BadRequestException(`Empresa ${companyId} no encontrada`);
    }
    const admin = company.userCompanies[0]?.user;
    if (!admin?.email) {
      throw new BadRequestException(
        `La empresa ${companyId} no tiene un administrador con email para firmar`,
      );
    }

    const signerName = [admin.name, admin.lastName].filter(Boolean).join(' ');
    const data: Record<string, string> = {
      LOGO_URL: this.logoUrl,
      // Cliente
      CLIENTE_RAZON_SOCIAL: company.name,
      CLIENTE_NIT: company.nit,
      CLIENTE_CIUDAD: company.city,
      CLIENTE_DEPARTAMENTO: company.state,
      CLIENTE_DIRECCION: company.address,
      CLIENTE_REPRESENTANTE: signerName,
      CLIENTE_TIPO_DOC: admin.identificationType?.label ?? '',
      CLIENTE_NUM_DOC: admin.identificationNumber ?? '',
      // Proveedor (Creditia) — valores fijos
      PROVEEDOR_RAZON_SOCIAL: this.creditia.legalName,
      PROVEEDOR_NIT: this.creditia.nit,
      PROVEEDOR_CIUDAD: this.creditia.city,
      PROVEEDOR_REPRESENTANTE: this.creditia.signerName,
    };

    // 1. Crear el documento desde la plantilla (Zapsign envía la solicitud al
    //    cliente automáticamente).
    const doc = await this.zapsign.createDocFromTemplate({
      templateId: this.templateId,
      signerName,
      signerEmail: admin.email,
      data,
    });

    // 2. El único firmante electrónico es el CLIENTE. Creditia NO firma: su
    //    firma/sello va pre-impresa en la plantilla (Creditia emite el contrato;
    //    el cliente lo acepta firmando). Así el documento queda 'signed' apenas
    //    el cliente firma (un solo firmante = completo).
    const clientSigner =
      doc.signers.find(
        (s) => s.email?.toLowerCase() === admin.email!.toLowerCase(),
      ) ?? doc.signers[0];

    // 4. Registrar el contrato en estado pending_contract.
    const pendingStatus = await this.repository.findParameterByTypeAndCode(
      'company_contract_status',
      'pending_contract',
    );
    if (!pendingStatus) {
      throw new BadRequestException(
        "Falta el parámetro company_contract_status 'pending_contract'",
      );
    }

    const commonData = {
      templateId: this.templateId,
      statusId: pendingStatus.id,
      zapsignDocToken: doc.docToken,
      clientSignerToken: clientSigner?.token ?? null,
      signUrl: clientSigner?.sign_url ?? null,
      signerName,
      signerEmail: admin.email,
      sentAt: new Date(),
    };

    if (existing) {
      // Reenvío tras rechazo: reutiliza el registro, limpia el estado de rechazo.
      await this.repository.update(existing.id, {
        ...commonData,
        refusedAt: null,
        refusedReason: null,
        signedAt: null,
        firstViewedAt: null,
        lastViewedAt: null,
        viewCount: 0,
      });
    } else {
      await this.repository.create({ companyId, ...commonData });
    }

    this.logger.log(
      `Contrato macro ${existing ? 'reenviado' : 'enviado'} a la empresa ${companyId} (doc=${doc.docToken})`,
    );
  }

  /**
   * Procesa el webhook doc_signed de Zapsign. NO confía en el payload como
   * fuente de verdad: usa el doc token solo para ubicar el contrato y re-consulta
   * el estado real a Zapsign (getDocState). Solo activa la cuenta si Zapsign
   * confirma status='signed' (todos firmaron). Idempotente ante reintentos y
   * ante el doc_signed de cada firmante (llega uno por firma).
   */
  async handleDocSigned(payload: ZapsignWebhookPayload): Promise<void> {
    const docToken = extractDocToken(payload);
    this.logger.log(
      `Webhook Zapsign doc_signed: doc=${docToken}, payloadStatus=${payload?.status}, firmó=${payload?.signer_who_signed?.email ?? '?'}`,
    );
    if (!docToken) {
      this.logger.warn('Webhook Zapsign sin token de documento; ignorado');
      return;
    }

    const contract = await this.repository.findByDocToken(docToken);
    if (!contract) {
      this.logger.warn(`Contrato no encontrado para doc=${docToken}; ignorado`);
      return;
    }
    if (contract.signedAt) {
      this.logger.log(`Contrato ${contract.id} ya estaba firmado; ignorado`);
      return;
    }

    // Estado autoritativo (no el del payload).
    const state = await this.zapsign.getDocState(docToken);

    // Solo activamos cuando TODOS firmaron (status='signed'). El doc_signed de
    // Creditia (o de un firmante intermedio) deja el doc en 'pending' → esperamos.
    if (state.status !== 'signed') {
      this.logger.log(
        `Contrato ${contract.id} aún no completo (status=${state.status}); esperando la firma restante`,
      );
      return;
    }

    // Descargar el PDF firmado a Supabase Storage (respaldo). Best-effort: si
    // falla la descarga, igual activamos (el doc queda en Zapsign) y dejamos la
    // ruta en null para reintentar luego.
    let storagePath: string | null = null;
    if (state.signedFileUrl) {
      try {
        const pdf = await this.zapsign.downloadDocument(state.signedFileUrl);
        storagePath = await this.supabaseService.uploadFile(
          this.storageBucket,
          `${contract.companyId}/${contract.id}.pdf`,
          pdf,
          'application/pdf',
        );
      } catch (e) {
        this.logger.error(
          `No se pudo respaldar el PDF firmado del contrato ${contract.id}: ${(e as Error).message}`,
        );
      }
    }

    const signedStatus = await this.repository.findParameterByTypeAndCode(
      'company_contract_status',
      'signed',
    );
    if (!signedStatus) {
      throw new BadRequestException(
        "Falta el parámetro company_contract_status 'signed'",
      );
    }

    const activated = await this.repository.markSignedAndActivate({
      contractId: contract.id,
      companyId: contract.companyId,
      signedStatusId: signedStatus.id,
      signedFileStoragePath: storagePath,
      signedDocumentUrl: state.signedFileUrl,
      signedAt: new Date(),
    });

    this.logger.log(
      activated
        ? `Contrato ${contract.id} FIRMADO y cuenta ${contract.companyId} ACTIVADA`
        : `Contrato ${contract.id} ya había sido activado (webhook concurrente)`,
    );
  }

  /**
   * Procesa el webhook doc_refused: el cliente rechazó firmar el contrato.
   * Marca el contrato como 'refused' con el motivo y NO activa la cuenta. A
   * diferencia de la firma, aquí un webhook falso solo desactivaría (no hay
   * incentivo de ataque), pero igual verificamos contra Zapsign que el doc no
   * esté en realidad firmado antes de marcarlo rechazado. Idempotente.
   */
  async handleDocRefused(payload: ZapsignWebhookPayload): Promise<void> {
    const docToken = extractDocToken(payload);
    this.logger.log(
      `Webhook Zapsign doc_refused: doc=${docToken}, motivo=${payload?.rejected_reason ?? '(sin motivo)'}`,
    );
    if (!docToken) {
      this.logger.warn('Webhook doc_refused sin token de documento; ignorado');
      return;
    }

    const contract = await this.repository.findByDocToken(docToken);
    if (!contract) {
      this.logger.warn(`Contrato no encontrado para doc=${docToken}; ignorado`);
      return;
    }
    if (contract.signedAt) {
      // Ya firmado: un doc_refused tardío/erróneo no debe revertir una firma.
      this.logger.warn(
        `Contrato ${contract.id} ya estaba firmado; se ignora doc_refused`,
      );
      return;
    }
    if (contract.refusedAt) {
      this.logger.log(`Contrato ${contract.id} ya estaba rechazado; ignorado`);
      return;
    }

    // Verificación defensiva: que Zapsign no reporte el doc como firmado.
    const state = await this.zapsign.getDocState(docToken);
    if (state.status === 'signed') {
      this.logger.warn(
        `doc_refused para ${contract.id} pero Zapsign dice status=signed; se ignora`,
      );
      return;
    }

    const refusedStatus = await this.repository.findParameterByTypeAndCode(
      'company_contract_status',
      'refused',
    );
    if (!refusedStatus) {
      throw new BadRequestException(
        "Falta el parámetro company_contract_status 'refused'",
      );
    }

    await this.repository.update(contract.id, {
      statusId: refusedStatus.id,
      refusedAt: new Date(),
      refusedReason: payload?.rejected_reason ?? null,
    });
    this.logger.log(
      `Contrato ${contract.id} marcado como RECHAZADO (empresa ${contract.companyId} sigue inactiva)`,
    );
  }

  /**
   * Procesa el webhook doc_viewed: registra que el cliente abrió el contrato
   * (seguimiento comercial). Solo cuenta la visualización del firmante CLIENTE
   * (ignora la de Creditia, que firma por API). No toca el flujo de firma ni
   * activa nada. Best-effort: es telemetría, no debe romper por datos raros.
   */
  async handleDocViewed(payload: ZapsignWebhookPayload): Promise<void> {
    const docToken = extractDocToken(payload);
    const viewer = payload?.signer_who_viewed;
    this.logger.log(
      `Webhook Zapsign doc_viewed: doc=${docToken}, vio=${viewer?.email ?? '?'}`,
    );
    if (!docToken) return;

    const contract = await this.repository.findByDocToken(docToken);
    if (!contract) {
      this.logger.warn(`Contrato no encontrado para doc=${docToken}; ignorado`);
      return;
    }

    // Solo nos interesa la visualización del cliente (el firmante del contrato).
    // Si el evento es de otro (p. ej. Creditia), lo ignoramos.
    if (
      viewer?.email &&
      viewer.email.toLowerCase() !== contract.signerEmail.toLowerCase()
    ) {
      this.logger.log(
        `doc_viewed de ${viewer.email} no es el cliente (${contract.signerEmail}); ignorado`,
      );
      return;
    }

    const viewedAt = viewer?.last_view_at
      ? new Date(viewer.last_view_at)
      : new Date();
    await this.repository.registerView(
      contract.id,
      isNaN(viewedAt.getTime()) ? new Date() : viewedAt,
      viewer?.times_viewed,
    );
    this.logger.log(`Visualización registrada para el contrato ${contract.id}`);
  }

  /**
   * Estado del contrato macro de una empresa para el front (o null si nunca se
   * ha enviado). No consulta a Zapsign: devuelve lo que tenemos guardado.
   */
  async getContractStatus(companyId: string) {
    const contract = await this.repository.findByCompanyId(companyId);
    if (!contract) return null;
    const status = await this.prisma.parameter.findUnique({
      where: { id: contract.statusId },
    });
    return {
      id: contract.id,
      status: status?.code ?? null,
      statusLabel: status?.label ?? null,
      signUrl: contract.signUrl,
      sentAt: contract.sentAt,
      signedAt: contract.signedAt,
      refusedAt: contract.refusedAt,
      refusedReason: contract.refusedReason,
      firstViewedAt: contract.firstViewedAt,
      lastViewedAt: contract.lastViewedAt,
      viewCount: contract.viewCount,
    };
  }

  /**
   * Devuelve una URL fresca para que el cliente descargue/vea su contrato
   * firmado, o null si aún no está firmado.
   *
   * La fuente es el respaldo en Supabase Storage (nuestra copia de largo plazo):
   * el bucket es privado, así que se firma una URL temporal en cada llamada.
   * Solo si el respaldo no existe —la descarga del webhook fue best-effort y
   * pudo fallar— se recurre a Zapsign, cuyo signed_file expira ~60 min.
   */
  async getSignedContractUrl(companyId: string): Promise<string | null> {
    const contract = await this.repository.findByCompanyId(companyId);
    if (!contract || !contract.signedAt) return null;

    if (contract.signedFileStoragePath) {
      return this.supabaseService.createSignedUrl(
        this.storageBucket,
        contract.signedFileStoragePath,
        this.signedUrlTtlSeconds,
      );
    }

    this.logger.warn(
      `Contrato ${contract.id} sin respaldo en Storage; se sirve desde Zapsign`,
    );
    const state = await this.zapsign.getDocState(contract.zapsignDocToken);
    return state.signedFileUrl;
  }
}
