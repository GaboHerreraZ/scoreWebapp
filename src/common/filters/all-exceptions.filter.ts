import {
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { SentryExceptionCaptured } from '@sentry/nestjs';
import type { Request } from 'express';

/**
 * Filtro global que captura TODA excepción no manejada de cualquier endpoint.
 *
 * - Loguea el error con contexto (método, URL, status, usuario) para poder
 *   rastrearlo después; las 5xx van como error (con stack), las 4xx como warn.
 * - Reporta a Sentry vía @SentryExceptionCaptured() cuando SENTRY_DSN está
 *   configurado (si no, el decorador no hace nada).
 * - Responde un JSON consistente { statusCode, message, timestamp, path }.
 *
 * Las HttpException (NotFound, Conflict, BadRequest...) conservan su status y
 * mensaje; cualquier otra cosa (bug, fallo de Prisma, etc.) se vuelve un 500
 * genérico sin filtrar detalles internos al cliente.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  @SentryExceptionCaptured()
  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    // Mensaje para el cliente: el de la HttpException, o uno genérico para no
    // filtrar internals en un 500.
    const message = isHttp
      ? exception.getResponse()
      : 'Error interno del servidor';

    const user = (request as any).user as
      | { id?: string; email?: string }
      | undefined;
    const where = `${request.method} ${request.url}`;
    const who = user?.id ? ` user=${user.id}` : '';

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // 5xx: error real → log completo con stack para diagnosticar.
      this.logger.error(
        `${status} ${where}${who} :: ${
          exception instanceof Error ? exception.message : String(exception)
        }`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      // 4xx: error esperado del cliente → solo aviso, sin stack.
      this.logger.warn(
        `${status} ${where}${who} :: ${
          exception instanceof Error ? exception.message : String(exception)
        }`,
      );
    }

    const responseBody = {
      statusCode: status,
      message:
        typeof message === 'object' && message !== null && 'message' in message
          ? (message as { message: unknown }).message
          : message,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    httpAdapter.reply(ctx.getResponse(), responseBody, status);
  }
}
