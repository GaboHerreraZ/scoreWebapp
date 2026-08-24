import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  parseInvoiceEnvironment,
  type InvoiceEnvironment,
} from '../domain/invoice-document.js';

export interface AliaddoCallResult {
  httpStatus: number;
  /** Cuerpo tal como llegó (objeto o arreglo si era JSON; string si no). */
  raw: unknown;
  ok: boolean;
}

/** Timeout de la llamada. La DIAN puede tardar: no conviene apretarlo mucho. */
const REQUEST_TIMEOUT_MS = 60_000;

/** Tope de espera tras un 429. Más allá de esto es mejor fallar y reintentar. */
const MAX_RATE_LIMIT_WAIT_MS = 15_000;

/**
 * HTTP puro contra Aliaddo. No sabe de dominio ni de negocio: recibe la ruta y
 * el payload ya armados, los envía y devuelve el crudo. Traducir es trabajo del
 * mapper.
 *
 * El token no expira de forma documentada (se genera y revoca desde el portal),
 * así que no hay ciclo de refresh como en Experian.
 */
@Injectable()
export class AliaddoClient {
  private readonly logger = new Logger(AliaddoClient.name);

  private readonly baseUrl: string;
  private readonly token: string;
  /**
   * Ambiente DECLARADO. Con esta API no viaja en el payload: el ambiente real lo
   * define la cuenta a la que pertenece el token. Sirve para etiquetar y advertir.
   */
  readonly environment: InvoiceEnvironment;
  /** Sucursal configurada a mano. Si falta, se resuelve la que Aliaddo marque. */
  readonly configuredBranchId: string | null;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = (
      this.configService.get<string>('ALIADDO_API_URL') ??
      'https://nitro.aliaddo.net'
    ).replace(/\/+$/, '');
    this.token = this.configService.get<string>('ALIADDO_TOKEN') ?? '';
    // Sin default: un ambiente mal escrito revienta al arrancar, no en silencio.
    this.environment = parseInvoiceEnvironment(
      this.configService.get<string>('EINVOICE_ENVIRONMENT'),
    );
    this.configuredBranchId =
      this.configService.get<string>('ALIADDO_BRANCH_ID') || null;

    this.logger.log(
      `Facturación electrónica en ambiente declarado '${this.environment}' (${this.baseUrl})`,
    );
  }

  /** true si hay credenciales para intentar la llamada. */
  get isConfigured(): boolean {
    return this.token.length > 0;
  }

  get(path: string, query?: Record<string, string | undefined>) {
    return this.request(`${path}${toQueryString(query)}`, { method: 'GET' });
  }

  post(path: string, payload: unknown) {
    return this.request(path, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  put(path: string, payload: unknown) {
    return this.request(path, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  patch(path: string, query?: Record<string, string | undefined>) {
    return this.request(`${path}${toQueryString(query)}`, { method: 'PATCH' });
  }

  delete(path: string) {
    return this.request(path, { method: 'DELETE' });
  }

  private async request(
    path: string,
    init: { method: string; body?: string },
    isRetry = false,
  ): Promise<AliaddoCallResult> {
    if (!this.isConfigured) {
      throw new InternalServerErrorException(
        'Falta ALIADDO_TOKEN: la facturación electrónica no está configurada',
      );
    }

    const url = `${this.baseUrl}${path}`;
    let response: Response;

    try {
      response = await fetch(url, {
        method: init.method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: init.body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Red caída o timeout: no llegamos a saber qué pasó con el documento.
      this.logger.error(
        `No se pudo contactar a Aliaddo (${init.method} ${path}): ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'No se pudo contactar al proveedor de facturación electrónica',
      );
    }

    // 401/403 son de configuración, no del documento: hay que enterarse fuerte.
    if (response.status === 401 || response.status === 403) {
      this.logger.error(
        `Aliaddo rechazó las credenciales (HTTP ${response.status})`,
      );
      throw new InternalServerErrorException(
        'Las credenciales de facturación electrónica no son válidas',
      );
    }

    // Rate limit: la ventana es de un minuto y la cabecera dice cuánto falta.
    // Un solo reintento — si vuelve a chocar, el problema no es de temporización.
    if (response.status === 429 && !isRetry) {
      const waitMs = this.rateLimitWaitMs(response);
      this.logger.warn(
        `Aliaddo devolvió 429 en ${init.method} ${path}; reintentando en ${waitMs} ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return this.request(path, init, true);
    }

    const raw = await this.readBody(response);

    // 4xx de datos (400/422) NO son excepción: el documento fue rechazado y el
    // motivo hay que guardarlo y mostrarlo. Los 5xx tampoco cortan aquí: el
    // service decide si reintentar. Ambos vuelven como resultado.
    return { httpStatus: response.status, raw, ok: response.ok };
  }

  /** Segundos que faltan para que se abra la ventana, acotados. */
  private rateLimitWaitMs(response: Response): number {
    const reset = Number(response.headers.get('X-Rate-Limit-Reset'));
    const waitMs = Number.isFinite(reset) && reset > 0 ? reset * 1000 : 5_000;
    return Math.min(waitMs, MAX_RATE_LIMIT_WAIT_MS);
  }

  private async readBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      // Algunos errores llegan como texto plano; se archiva igual.
      return text;
    }
  }
}

/** Query string omitiendo los parámetros sin valor. */
function toQueryString(query?: Record<string, string | undefined>): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.append(key, value);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}
