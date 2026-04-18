import { Global, Module } from '@nestjs/common';
import { ExcelService } from './excel.service.js';

@Global()
@Module({
  providers: [ExcelService],
  exports: [ExcelService],
})
export class ExcelModule {}
