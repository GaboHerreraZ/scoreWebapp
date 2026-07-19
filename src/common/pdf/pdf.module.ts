import { Global, Module } from '@nestjs/common';
import { PdfService } from './pdf.service.js';

/**
 * Servicio de renderizado HTML → PDF, global (mismo patrón que ExcelModule):
 * cualquier módulo puede inyectar PdfService sin re-importar. Mantiene un único
 * Chromium por proceso, así que conviene un solo provider compartido.
 */
@Global()
@Module({
  providers: [PdfService],
  exports: [PdfService],
})
export class PdfModule {}
