import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Un firmante tal como lo devuelve Zapsign en la respuesta de crear documento. */
export interface ZapsignSigner {
  token: string;
  name: string | null;
  email: string | null;
  status: string; // 'new' | 'link-opened' | 'signed'
  sign_url: string | null;
}

/** Resultado de crear un documento a partir de una plantilla. */
export interface ZapsignCreateDocResult {
  docToken: string;
  signers: ZapsignSigner[];
}

/** Estado autoritativo de un documento (consultado a Zapsign). */
export interface ZapsignDocState {
  token: string;
  status: string; // 'pending' | 'signed'
  signedFileUrl: string | null; // expira ~60 min
  signers: ZapsignSigner[];
}

export interface CreateDocFromTemplateParams {
  templateId: string;
  /** Firmante principal (el cliente). */
  signerName: string;
  signerEmail: string;
  /** Variables {{...}} de la plantilla → valor. */
  data: Record<string, string>;
}

/**
 * Cliente de la API REST de Zapsign para el contrato macro. Espeja el patrón de
 * DocuSealService: crea documentos desde plantilla con variables prellenadas,
 * firma automáticamente la parte de Creditia por API, consulta el estado real de
 * un documento (para no confiar solo en el webhook) y descarga el PDF firmado.
 *
 * Auth: token estático en el header Authorization: Bearer.
 * Docs: https://docs.zapsign.com.br/espanol
 */
@Injectable()
export class ZapsignService {
  private readonly logger = new Logger(ZapsignService.name);
  private readonly apiUrl: string;
  private readonly apiToken: string;
  /** Token del usuario Creditia (Settings → firma vía API) para batch sign. */
  private readonly creditiaUserToken: string;

  constructor(private readonly configService: ConfigService) {
    this.apiUrl =
      this.configService.get<string>('ZAPSIGN_API_URL') ??
      'https://api.zapsign.com.br/api/v1';
    this.apiToken = this.configService.get<string>('ZAPSIGN_API_TOKEN') ?? '';
    this.creditiaUserToken =
      this.configService.get<string>('ZAPSIGN_CREDITIA_USER_TOKEN') ?? '';

    if (!this.apiToken) {
      this.logger.warn('ZAPSIGN_API_TOKEN is not configured');
    }
  }

  private authHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiToken}`,
    };
  }

  /**
   * Crea un documento a partir de una plantilla dinámica, reemplazando las
   * variables {{...}} con `data`. Zapsign envía automáticamente la solicitud de
   * firma al firmante (email/WhatsApp según la config de la plantilla).
   * POST /models/create-doc/
   */
  async createDocFromTemplate(
    params: CreateDocFromTemplateParams,
  ): Promise<ZapsignCreateDocResult> {
    const body = {
      template_id: params.templateId,
      signer_name: params.signerName,
      signer_email: params.signerEmail,
      data: Object.entries(params.data).map(([key, value]) => ({
        de: `{{${key}}}`,
        para: value,
      })),
    };

    try {
      const res = await fetch(`${this.apiUrl}/models/create-doc/`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(body),
      });
      const json: any = await res.json();
      if (!res.ok || !json?.token) {
        this.logger.error('Zapsign create-doc falló', json);
        throw new Error(json?.message ?? 'No se obtuvo token del documento');
      }

      return {
        docToken: json.token as string,
        signers: (json.signers ?? []) as ZapsignSigner[],
      };
    } catch (err) {
      this.logger.error(
        `Zapsign createDocFromTemplate failed: ${(err as Error).message}`,
      );
      throw new InternalServerErrorException(
        'No se pudo crear el contrato en Zapsign.',
      );
    }
  }

  /**
   * Firma programáticamente uno o más firmantes vía API (sin interacción
   * humana). Se usa para que Creditia firme su parte al instante después de
   * crear el documento. Requiere ZAPSIGN_CREDITIA_USER_TOKEN (usuario con firma
   * vía API habilitada y cuyo email coincide con el firmante de Creditia en la
   * plantilla). No consume créditos.
   * POST /sign/
   */
  async batchSign(signerTokens: string[]): Promise<void> {
    if (!this.creditiaUserToken) {
      this.logger.warn(
        'ZAPSIGN_CREDITIA_USER_TOKEN no configurado: se omite la firma automática de Creditia',
      );
      return;
    }
    if (signerTokens.length === 0) return;

    try {
      const res = await fetch(`${this.apiUrl}/sign/`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({
          user_token: this.creditiaUserToken,
          signer_tokens: signerTokens,
        }),
      });
      if (!res.ok) {
        const json: any = await res.json().catch(() => ({}));
        this.logger.error('Zapsign batch sign falló', json);
        throw new Error(json?.message ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      this.logger.error(`Zapsign batchSign failed: ${(err as Error).message}`);
      throw new InternalServerErrorException(
        'No se pudo firmar la parte de Creditia en Zapsign.',
      );
    }
  }

  /**
   * Consulta el estado autoritativo de un documento en Zapsign. Lo usa el
   * webhook para verificar que un payload entrante coincide con lo que Zapsign
   * realmente sabe (un webhook falsificado no puede marcar el contrato como
   * firmado). status='signed' ⇒ todos los firmantes completaron.
   * GET /docs/{token}/
   */
  async getDocState(docToken: string): Promise<ZapsignDocState> {
    try {
      const res = await fetch(`${this.apiUrl}/docs/${docToken}/`, {
        method: 'GET',
        headers: this.authHeaders(),
      });
      const json: any = await res.json();
      if (!res.ok || !json?.token) {
        this.logger.error('Zapsign detalhar-documento falló', json);
        throw new Error(json?.message ?? 'No se obtuvo el documento');
      }
      return {
        token: json.token as string,
        status: json.status as string,
        signedFileUrl: (json.signed_file ?? null) as string | null,
        signers: (json.signers ?? []) as ZapsignSigner[],
      };
    } catch (err) {
      this.logger.error(`Zapsign getDocState failed: ${(err as Error).message}`);
      throw new InternalServerErrorException(
        'No se pudo consultar el estado del contrato en Zapsign.',
      );
    }
  }

  /**
   * Descarga el PDF firmado desde la URL signed_file de Zapsign y lo devuelve
   * como Buffer. Estas URLs expiran (~60 min), así que la URL debe obtenerse de
   * getDocState justo antes de descargar.
   */
  async downloadDocument(url: string): Promise<Buffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new InternalServerErrorException(
        `No se pudo descargar el contrato firmado desde Zapsign (HTTP ${response.status}).`,
      );
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
