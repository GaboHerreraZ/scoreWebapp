import { Module } from '@nestjs/common';
import { ZapsignService } from './zapsign.service.js';

/**
 * Capa de firma electrónica compartida por todos los tipos de documento
 * (contrato macro, y los que vengan). Envuelve el cliente de firma (Zapsign).
 * Es agnóstica del tipo de documento: cada módulo de documento la importa para
 * crear firmas sin duplicar la integración.
 */
@Module({
  providers: [ZapsignService],
  exports: [ZapsignService],
})
export class SigningModule {}
