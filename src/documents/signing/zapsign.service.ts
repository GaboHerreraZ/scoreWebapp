import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ZapsignSigner {
  token: string;
  name: string | null;
  email: string | null;
  status: string; // 'new' | 'link-opened' | 'signed'
  sign_url: string | null;
}

export interface ZapsignCreateDocResult {
  docToken: string;
  signers: ZapsignSigner[];
}

export interface ZapsignDocState {
  token: string;
  status: string; // 'pending' | 'signed'
  signedFileUrl: string | null; // expira ~60 min
  signers: ZapsignSigner[];
}

export interface CreateDocFromTemplateParams {
  templateId: string;
  signerName: string;
  signerEmail: string;
  data: Record<string, string>;
  /**
   * Ancla de texto de la plantilla (`<<...>>`) donde Zapsign estampa la firma.
   * Si el ancla aparece varias veces, la estampa en TODAS las ocurrencias.
   */
  signaturePlacementAnchor?: string;
}

/**
 * Cliente de la API REST de Zapsign: crea documentos desde plantilla con
 * variables prellenadas, consulta el estado real de un documento (para no
 * confiar solo en el webhook) y descarga el PDF firmado.
 *
 * Auth: token estático en el header Authorization: Bearer.
 * Docs: https://docs.zapsign.com.br/espanol
 */
@Injectable()
export class ZapsignService {
  private readonly logger = new Logger(ZapsignService.name);
  private readonly apiUrl: string;
  private readonly apiToken: string;
  /**
   * Flag sandbox de Zapsign (por documento, no un entorno/URL/token aparte).
   * sandbox=true crea documentos de PRUEBA: no gastan cuota ni producen firmas
   * con validez legal. Debe ir en TRUE en staging/desarrollo y FALSE en
   * producción (si no, los documentos reales quedarían marcados como prueba).
   */
  private readonly sandbox: boolean;

  constructor(private readonly configService: ConfigService) {
    this.sandbox =
      this.configService.get<string>('ZAPSIGN_SANDBOX', 'false') === 'true';
    this.apiUrl =
      this.configService.get<string>('ZAPSIGN_API_URL') ??
      'https://api.zapsign.com.br/api/v1';
    this.apiToken = this.configService.get<string>('ZAPSIGN_API_TOKEN') ?? '';

    if (!this.apiToken) {
      this.logger.warn('ZAPSIGN_API_TOKEN is not configured');
    }
    if (this.sandbox) {
      this.logger.warn('ZapsignService en modo SANDBOX (pruebas)');
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
    const body: Record<string, unknown> = {
      template_id: params.templateId,
      signer_name: params.signerName,
      signer_email: params.signerEmail,
      sandbox: this.sandbox,
      send_automatic_email: true,
      data: Object.entries(params.data).map(([key, value]) => ({
        de: `{{${key}}}`,
        para: value,
      })),
    };
    if (params.signaturePlacementAnchor) {
      body.signature_placement = params.signaturePlacementAnchor;
    }

    try {
      const res = await fetch(`${this.apiUrl}/models/create-doc/`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(body),
      });

      const raw = await res.text();
      let json: any = null;
      try {
        json = raw ? JSON.parse(raw) : null;
      } catch {
        json = null;
      }

      if (!res.ok || !json?.token) {
        const detail = json?.message ?? json?.detail ?? raw ?? '(sin cuerpo)';
        this.logger.error(
          `Zapsign create-doc falló (HTTP ${res.status}): ${detail}`,
        );
        throw new InternalServerErrorException(
          `No se pudo crear el documento en Zapsign: ${detail}`,
        );
      }

      return {
        docToken: json.token as string,
        signers: (json.signers ?? []) as ZapsignSigner[],
      };
    } catch (err) {
      if (err instanceof InternalServerErrorException) throw err;
      this.logger.error(
        `Zapsign createDocFromTemplate failed: ${(err as Error).message}`,
      );
      throw new InternalServerErrorException(
        'No se pudo crear el documento en Zapsign.',
      );
    }
  }

  /**
   * Consulta el estado autoritativo de un documento en Zapsign. Lo usa el
   * webhook para verificar que un payload entrante coincide con lo que Zapsign
   * realmente sabe (un webhook falsificado no puede marcar el documento como
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
      this.logger.error(
        `Zapsign getDocState failed: ${(err as Error).message}`,
      );
      throw new InternalServerErrorException(
        'No se pudo consultar el estado del documento en Zapsign.',
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
        `No se pudo descargar el documento firmado desde Zapsign (HTTP ${response.status}).`,
      );
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
