import { Module } from '@nestjs/common';
import { EpaycoService } from './epayco.service.js';
import { EpaycoDebugController } from './epayco-debug.controller.js';

@Module({
  controllers: [EpaycoDebugController],
  providers: [EpaycoService],
  exports: [EpaycoService],
})
export class EpaycoModule {}
