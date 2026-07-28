import { Global, Module } from '@nestjs/common';
import { PdfService } from './pdf.service.js';

/**
 * Servicio de renderizado HTML → PDF, global (mismo patrón que ExcelModule):
 * cualquier módulo puede inyectar PdfService sin re-importar. El render lo hace
 * Gotenberg (servicio externo vía HTTP), así que este provider es apenas un
 * cliente sin estado.
 */
@Global()
@Module({
  providers: [PdfService],
  exports: [PdfService],
})
export class PdfModule {}
