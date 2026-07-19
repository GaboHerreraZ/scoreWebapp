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
