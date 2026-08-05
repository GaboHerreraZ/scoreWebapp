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
}

export interface AddSignerParams {
  docToken: string;
  name: string;
  email?: string;
  /**
   * Ancla de texto de la plantilla (`<<...>>`) donde Zapsign estampa la firma.
   * Si se omite, Zapsign anexa una página de firmas al final del documento.
   */
  signaturePlacementAnchor?: string;
  /** Por defecto false: los firmantes internos no deben recibir notificación. */
  notify?: boolean;
}

/**
 * Cliente de la API REST de Zapsign para el contrato macro: crea documentos
 * desde plantilla con variables prellenadas, agrega firmantes, firma en nombre
 * de un usuario de nuestra propia organización (la parte de Creditia), consulta
 * el estado real de un documento (para no confiar solo en el webhook) y descarga
 * el PDF firmado.
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
   * producción (si no, los contratos reales quedarían marcados como prueba).
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
    const body = {
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
          `No se pudo crear el contrato en Zapsign: ${detail}`,
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
        'No se pudo crear el contrato en Zapsign.',
      );
    }
  }

  /**
   * Añade un firmante a un documento ya creado. Hace falta porque
   * /models/create-doc/ solo admite UN firmante (signer_name/signer_email): el
   * segundo (Creditia) se agrega aquí.
   * POST /docs/{token}/add-signer/
   */
  async addSigner(params: AddSignerParams): Promise<ZapsignSigner> {
    const notify = params.notify ?? false;
    const body: Record<string, unknown> = {
      name: params.name,
      send_automatic_email: notify,
      send_automatic_whatsapp: notify,
    };
    if (params.email) body.email = params.email;
    if (params.signaturePlacementAnchor) {
      body.signature_placement = params.signaturePlacementAnchor;
    }

    const res = await fetch(
      `${this.apiUrl}/docs/${params.docToken}/add-signer/`,
      {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(body),
      },
    );

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
        `Zapsign add-signer falló (HTTP ${res.status}): ${detail}`,
      );
      throw new InternalServerErrorException(
        `No se pudo agregar el firmante en Zapsign: ${detail}`,
      );
    }

    return json as ZapsignSigner;
  }

  /**
   * Firma uno o varios documentos en nombre de un usuario de NUESTRA propia
   * organización de Zapsign (endpoint "firma en lote"). Es lo que permite que el
   * representante legal de Creditia no tenga que abrir ningún enlace: su firma y
   * rúbrica están guardadas en su perfil y Zapsign las estampa por API.
   *
   * Requisitos del lado de Zapsign (si faltan, responde 400/404):
   *  - add-on "Batch signing" activo en la cuenta,
   *  - el firmante debe ser usuario de la organización, con nombre, apellido,
   *    teléfono, firma y rúbrica cargados y el switch "Firmar a través de API",
   *  - el email del firmante del documento debe ir vacío o coincidir con el suyo,
   *  - autenticación estándar ("firma en pantalla"); nada de selfie/biometría.
   *
   * OJO: es ASÍNCRONO. Un 200 significa "encolado", no "ya firmado"; la firma se
   * confirma después por webhook o consultando getDocState.
   * POST /sign/
   */
  async signAsAccountUser(
    userToken: string,
    signerTokens: string[],
  ): Promise<void> {
    if (!signerTokens.length) return;

    const res = await fetch(`${this.apiUrl}/sign/`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({
        user_token: userToken,
        signer_tokens: signerTokens,
      }),
    });

    if (!res.ok) {
      const detail = (await res.text()) || '(sin cuerpo)';
      this.logger.error(`Zapsign sign falló (HTTP ${res.status}): ${detail}`);
      throw new InternalServerErrorException(
        `No se pudo firmar por API en Zapsign: ${detail}`,
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
      this.logger.error(
        `Zapsign getDocState failed: ${(err as Error).message}`,
      );
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
