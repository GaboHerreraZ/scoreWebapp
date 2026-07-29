import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface ExperianTokenResponse {
  issued_at: string;
  expires_in: string;
  token_type: string;
  access_token: string;
  refresh_token: string;
}

export interface ExperianQueryParams {
  tipoIdentificacion: string; // código Experian: '1'=CC, '2'=NIT, '4'=CE, '5'=PAS
  numeroIdentificacion: string;
  apellidoRazonSocial: string;
}

export interface ExperianQueryResult {
  httpStatus: number;
  raw: unknown;
}

export interface ExperianConnectionCheck {
  ok: boolean;
  baseUrl: string;
  username: string;
  httpStatus: number | null;
  durationMs: number;
  token: {
    preview: string;
    length: number;
    type: string | null;
    issuedAt: string | null;
    expiresIn: string | null;
  } | null;
  error: string | null;
  message: string;
}

@Injectable()
export class ExperianClient {
  private readonly logger = new Logger(ExperianClient.name);

  private readonly baseUrl: string;
  // client_id / client_secret son los mismos para PN y PJ; solo cambia el usuario.
  private readonly clientId: string;
  private readonly clientSecret: string;
  // La contraseña también es compartida hoy, pero se lee por tipo de persona por
  // si DataCrédito las separa a futuro (con fallback a la genérica).
  private readonly usernamePn: string;
  private readonly usernamePj: string;
  private readonly passwordPn: string;
  private readonly passwordPj: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = (
      this.configService.get<string>('EXPERIAN_BASE_URL') ?? ''
    ).replace(/\/+$/, '');
    this.clientId = this.configService.get<string>('EXPERIAN_CLIENT_ID') ?? '';
    this.clientSecret =
      this.configService.get<string>('EXPERIAN_CLIENT_SECRET') ?? '';

    const genericPassword =
      this.configService.get<string>('EXPERIAN_PASSWORD') ?? '';
    this.usernamePn =
      this.configService.get<string>('EXPERIAN_USERNAME_PN') ?? '';
    this.usernamePj =
      this.configService.get<string>('EXPERIAN_USERNAME_PJ') ?? '';
    this.passwordPn =
      this.configService.get<string>('EXPERIAN_PASSWORD_PN') ?? genericPassword;
    this.passwordPj =
      this.configService.get<string>('EXPERIAN_PASSWORD_PJ') ?? genericPassword;

    if (
      !this.baseUrl ||
      !this.clientId ||
      !this.clientSecret ||
      !this.usernamePn ||
      !this.usernamePj
    ) {
      this.logger.warn(
        'Credenciales de Experian incompletas (EXPERIAN_BASE_URL / CLIENT_ID / CLIENT_SECRET / USERNAME_PN / USERNAME_PJ).',
      );
    }
  }

  /**
   * Selecciona las credenciales de usuario según el tipo de identificación.
   * NIT ('2') → persona jurídica; el resto (CC, CE, PAS…) → persona natural.
   */
  private resolveCredentials(tipoIdentificacion: string): {
    username: string;
    password: string;
  } {
    const isLegalEntity = tipoIdentificacion === '2';
    return isLegalEntity
      ? { username: this.usernamePj, password: this.passwordPj }
      : { username: this.usernamePn, password: this.passwordPn };
  }

  private async getToken(credentials: {
    username: string;
    password: string;
  }): Promise<string> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/spla/oauth2/v1/token`, {
        method: 'POST',
        headers: {
          client_id: this.clientId,
          client_secret: this.clientSecret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: credentials.username,
          password: credentials.password,
        }),
      });
    } catch (err) {
      this.logger.error(
        `Fallo de red al generar token Experian: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'No se pudo contactar el servicio de autenticación de DataCrédito.',
      );
    }

    if (!response.ok) {
      const detail = await this.safeText(response);
      this.logger.error(
        `Token Experian rechazado (HTTP ${response.status}): ${detail}`,
      );
      throw new InternalServerErrorException(
        'DataCrédito rechazó las credenciales de autenticación.',
      );
    }

    const data = (await response.json()) as ExperianTokenResponse;
    if (!data.access_token) {
      throw new InternalServerErrorException(
        'DataCrédito no devolvió un token de acceso.',
      );
    }
    return data.access_token;
  }

  /**
   * Verifica la conexión con DataCrédito pidiendo un token con las credenciales
   * YA CONFIGURADAS (EXPERIAN_*) del entorno en que corre la app. Es la prueba
   * de que la IP de salida está autorizada: la central corta por IP antes de
   * mirar el usuario, así que un token devuelto implica IP habilitada.
   *
   * A diferencia de getToken, NO lanza: devuelve el diagnóstico (incluido el
   * cuerpo del error de la central, que es lo que distingue "IP no autorizada"
   * de "credenciales inválidas").
   *
   * @param personType 'pj' usa el usuario de persona jurídica; por defecto el de
   *                   persona natural. La autorización de IP es la misma para
   *                   ambos; sirve para validar cada cuenta por separado.
   */
  async checkConnection(
    personType: 'pn' | 'pj' = 'pn',
  ): Promise<ExperianConnectionCheck> {
    const { username, password } = this.resolveCredentials(
      personType === 'pj' ? '2' : '1',
    );

    const base = {
      baseUrl: this.baseUrl,
      username,
    };

    if (!this.baseUrl || !this.clientId || !this.clientSecret || !username) {
      return {
        ...base,
        ok: false,
        httpStatus: null,
        durationMs: 0,
        token: null,
        error: null,
        message:
          'Faltan variables de entorno de DataCrédito (EXPERIAN_BASE_URL / CLIENT_ID / CLIENT_SECRET / USERNAME). No se intentó la conexión.',
      };
    }

    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/spla/oauth2/v1/token`, {
        method: 'POST',
        headers: {
          client_id: this.clientId,
          client_secret: this.clientSecret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });
    } catch (err) {
      const detail = (err as Error).message;
      this.logger.error(`Chequeo de conexión con DataCrédito falló: ${detail}`);
      return {
        ...base,
        ok: false,
        httpStatus: null,
        durationMs: Date.now() - startedAt,
        token: null,
        error: detail,
        message:
          'No hubo respuesta de DataCrédito (fallo de red, DNS o bloqueo de salida). Ni siquiera se llegó a la validación de IP.',
      };
    }

    const durationMs = Date.now() - startedAt;

    if (!response.ok) {
      const detail = await this.safeText(response);
      this.logger.warn(
        `Chequeo de conexión con DataCrédito: HTTP ${response.status}`,
      );
      return {
        ...base,
        ok: false,
        httpStatus: response.status,
        durationMs,
        token: null,
        error: detail || null,
        message:
          response.status === 401 || response.status === 403
            ? `DataCrédito rechazó la autenticación (HTTP ${response.status}). Suele ser IP no autorizada o credenciales inválidas: revisa el detalle en "error".`
            : `DataCrédito respondió HTTP ${response.status} al pedir el token.`,
      };
    }

    const data = (await this.safeJson(
      response,
    )) as ExperianTokenResponse | null;
    const accessToken = data?.access_token;
    if (!accessToken) {
      return {
        ...base,
        ok: false,
        httpStatus: response.status,
        durationMs,
        token: null,
        error: null,
        message:
          'DataCrédito respondió 200 pero sin access_token en el cuerpo. Respuesta inesperada.',
      };
    }

    return {
      ...base,
      ok: true,
      httpStatus: response.status,
      durationMs,
      token: {
        // Solo un prefijo: el token es una credencial viva, no se expone entero.
        preview: `${accessToken.slice(0, 12)}…`,
        length: accessToken.length,
        type: data?.token_type ?? null,
        issuedAt: data?.issued_at ?? null,
        expiresIn: data?.expires_in ?? null,
      },
      error: null,
      message:
        'Conexión OK: DataCrédito devolvió un token, así que la IP de salida está autorizada y las credenciales son válidas.',
    };
  }

  async queryMiDecisor(
    params: ExperianQueryParams,
  ): Promise<ExperianQueryResult> {
    const token = await this.getToken(
      this.resolveCredentials(params.tipoIdentificacion),
    );

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/co/cs/midecisor/v1/client`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tipoIdentificacion: params.tipoIdentificacion,
          numeroIdentificacion: params.numeroIdentificacion,
          apellidoRazonSocial: params.apellidoRazonSocial,
        }),
      });
    } catch (err) {
      this.logger.error(
        `Fallo de red al consultar MiDecisor: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'No se pudo contactar el servicio de consulta de DataCrédito.',
      );
    }

    const raw = await this.safeJson(response);
    return { httpStatus: response.status, raw };
  }

  private async safeJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  private async safeText(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch {
      return '';
    }
  }
}
