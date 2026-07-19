import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  errors as joseErrors,
  jwtVerify,
  type JWTPayload,
} from 'jose';

export interface VerifiedUser {
  id: string;
  email?: string;
}

/**
 * Verifica los access tokens de Supabase LOCALMENTE (firma + exp + iss + aud),
 * eliminando el round-trip de red a /auth/v1/user en cada request. Soporta los
 * dos esquemas de firma de Supabase:
 *
 *  - Signing keys nuevas (ES256/RS256): se validan contra el JWKS público del
 *    proyecto. jose descarga el set una vez, lo cachea en memoria y solo lo
 *    refresca ante un `kid` desconocido (rotación de llaves).
 *  - Legacy (HS256): requiere SUPABASE_JWT_SECRET (Dashboard → Settings → API
 *    → JWT Secret). Sin él no se puede verificar localmente.
 *
 * Contrato de verifyLocally:
 *  - Token VÁLIDO → VerifiedUser.
 *  - Token INVÁLIDO (firma, expirado, iss/aud incorrectos, malformado) →
 *    lanza UnauthorizedException.
 *  - NO SE PUEDE verificar localmente (HS256 sin secret, alg desconocido,
 *    JWKS inaccesible por red) → null; el guard hace fallback a auth.getUser
 *    para no tumbar la autenticación por un problema de configuración.
 */
@Injectable()
export class SupabaseJwtService {
  private readonly logger = new Logger(SupabaseJwtService.name);
  private readonly issuer: string;
  private readonly hsKey?: Uint8Array;
  private jwks?: ReturnType<typeof createRemoteJWKSet>;
  private warnedHsFallback = false;

  constructor(configService: ConfigService) {
    const supabaseUrl =
      configService.get<string>('SUPABASE_URL')?.replace(/\/+$/, '') ?? '';
    this.issuer = `${supabaseUrl}/auth/v1`;

    const secret = configService.get<string>('SUPABASE_JWT_SECRET');
    if (secret) {
      this.hsKey = new TextEncoder().encode(secret);
    }
  }

  async verifyLocally(token: string): Promise<VerifiedUser | null> {
    let alg: string | undefined;
    try {
      alg = decodeProtectedHeader(token).alg;
    } catch {
      // Ni siquiera es un JWT bien formado
      throw new UnauthorizedException('Token inválido o expirado');
    }

    try {
      let payload: JWTPayload;

      if (alg === 'HS256') {
        if (!this.hsKey) {
          if (!this.warnedHsFallback) {
            this.warnedHsFallback = true;
            this.logger.warn(
              'Token HS256 recibido sin SUPABASE_JWT_SECRET configurado: se usará ' +
                'validación remota (auth.getUser) como fallback en cada request. ' +
                'Configura SUPABASE_JWT_SECRET para validar localmente.',
            );
          }
          return null;
        }
        ({ payload } = await jwtVerify(
          token,
          this.hsKey,
          this.verifyOptions(['HS256']),
        ));
      } else if (alg === 'ES256' || alg === 'RS256') {
        this.jwks ??= createRemoteJWKSet(
          new URL(`${this.issuer}/.well-known/jwks.json`),
        );
        ({ payload } = await jwtVerify(
          token,
          this.jwks,
          this.verifyOptions([alg]),
        ));
      } else {
        return null; // algoritmo no soportado localmente → fallback remoto
      }

      if (!payload.sub) {
        throw new UnauthorizedException('Token inválido o expirado');
      }
      return { id: payload.sub, email: payload['email'] as string | undefined };
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      if (this.isInvalidTokenError(err)) {
        throw new UnauthorizedException('Token inválido o expirado');
      }
      // Problema ajeno al token (p. ej. no se pudo descargar el JWKS):
      // degradar a la validación remota en vez de rechazar a todo el mundo.
      this.logger.warn(
        `Verificación local no disponible (${err instanceof Error ? err.message : String(err)}); fallback a auth.getUser`,
      );
      return null;
    }
  }

  private verifyOptions(algorithms: string[]) {
    return {
      algorithms,
      issuer: this.issuer,
      audience: 'authenticated',
      clockTolerance: 5,
    };
  }

  private isInvalidTokenError(err: unknown): boolean {
    return (
      err instanceof joseErrors.JWTExpired ||
      err instanceof joseErrors.JWTClaimValidationFailed ||
      err instanceof joseErrors.JWSSignatureVerificationFailed ||
      err instanceof joseErrors.JWSInvalid ||
      err instanceof joseErrors.JWTInvalid ||
      err instanceof joseErrors.JWKSNoMatchingKey
    );
  }
}
