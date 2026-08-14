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
import type {
  AliaddoInvoiceRequest,
  AliaddoInvoiceResponse,
} from './aliaddo.types.js';

export interface AliaddoCallResult {
  httpStatus: number;
  /** Cuerpo tal como llegó (objeto si era JSON; string si no). */
  raw: unknown;
  /** El cuerpo tipado cuando la llamada fue 2xx. */
  body: AliaddoInvoiceResponse | null;
}

/** Timeout de la llamada. La DIAN puede tardar: no conviene apretarlo mucho. */
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * HTTP puro contra Aliaddo. No sabe de dominio ni de negocio: recibe el payload
 * ya armado, lo envía y devuelve el crudo. Traducir es trabajo del mapper.
 *
 * El token no expira de forma documentada (se genera y revoca desde el portal),
 * así que no hay ciclo de refresh como en Experian.
 */
@Injectable()
export class AliaddoClient {
  private readonly logger = new Logger(AliaddoClient.name);

  private readonly baseUrl: string;
  private readonly token: string;
  /** Ambiente en términos del dominio; el mapper lo traduce al `mode` de Aliaddo. */
  readonly environment: InvoiceEnvironment;
  readonly testSetId: string | null;

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
    this.testSetId =
      this.configService.get<string>('ALIADDO_TEST_SET_ID') || null;

    this.logger.log(
      `Facturación electrónica en ambiente '${this.environment}' (${this.baseUrl})`,
    );
  }

  /** true si hay credenciales para intentar la llamada. */
  get isConfigured(): boolean {
    return this.token.length > 0;
  }

  async createInvoice(
    payload: AliaddoInvoiceRequest,
  ): Promise<AliaddoCallResult> {
    return this.post('/v2/documents/invoices', payload);
  }

  /** Consulta un documento por prefijo + consecutivo (para los 'pending'). */
  async findInvoiceByPrefixAndConsecutive(
    prefix: string,
    consecutive: number,
  ): Promise<AliaddoCallResult> {
    const query = new URLSearchParams({
      prefix,
      consecutive: String(consecutive),
    });
    return this.get(
      `/v2/documents/invoices/find-by-prefix-and-consecutive?${query.toString()}`,
    );
  }

  private async post(
    path: string,
    payload: unknown,
  ): Promise<AliaddoCallResult> {
    return this.request(path, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  private async get(path: string): Promise<AliaddoCallResult> {
    return this.request(path, { method: 'GET' });
  }

  private async request(
    path: string,
    init: { method: string; body?: string },
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

    const raw = await this.readBody(response);

    // 401/403 son de configuración, no del documento: hay que enterarse fuerte.
    if (response.status === 401 || response.status === 403) {
      this.logger.error(
        `Aliaddo rechazó las credenciales (HTTP ${response.status})`,
      );
      throw new InternalServerErrorException(
        'Las credenciales de facturación electrónica no son válidas',
      );
    }

    // 4xx de datos (400/422) NO son excepción: el documento fue rechazado y el
    // motivo hay que guardarlo y mostrarlo. Los 5xx tampoco cortan aquí: el
    // service decide si reintentar. Ambos vuelven como resultado.
    return {
      httpStatus: response.status,
      raw,
      body: response.ok ? (raw as AliaddoInvoiceResponse) : null,
    };
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
