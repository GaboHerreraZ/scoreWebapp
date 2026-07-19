import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator.js';
import { SupabaseService } from '../supabase.service.js';
import { SupabaseJwtService } from '../supabase-jwt.service.js';

/** Request de Express con el usuario autenticado que adjunta este guard. */
interface AuthenticatedRequest extends Request {
  user?: { id: string; email?: string };
}

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly supabaseService: SupabaseService,
    private readonly supabaseJwtService: SupabaseJwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Encabezado de autorización faltante o inválido',
      );
    }

    const token = authHeader.substring(7);

    // Validación LOCAL del JWT (firma + exp + iss + aud): sin llamada de red.
    // Lanza UnauthorizedException si el token es inválido/expirado.
    const verified = await this.supabaseJwtService.verifyLocally(token);
    if (verified) {
      request.user = {
        id: verified.id,
        email: verified.email,
      };
      return true;
    }

    // Fallback remoto: solo cuando la verificación local no es posible
    // (HS256 sin SUPABASE_JWT_SECRET configurado o JWKS inaccesible).
    const { data, error } = await this.supabaseService
      .getClient()
      .auth.getUser(token);

    if (error || !data.user) {
      throw new UnauthorizedException('Token inválido o expirado');
    }

    request.user = {
      id: data.user.id,
      email: data.user.email,
    };

    return true;
  }
}
