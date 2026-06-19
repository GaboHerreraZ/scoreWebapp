import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../decorators/public.decorator.js';

/**
 * Controlador TEMPORAL de verificación de Sentry. Lanza un error a propósito
 * para comprobar que las excepciones no manejadas llegan al filtro global y se
 * reportan a Sentry. Es @Public() para poder invocarlo sin token.
 *
 * Eliminar (controller + registro en el módulo) una vez confirmado que el
 * evento aparece en el dashboard de Sentry.
 */
@ApiExcludeController()
@Controller('debug-sentry')
export class DebugController {
  @Public()
  @Get()
  getError(): never {
    throw new Error('My first Sentry error!');
  }
}
