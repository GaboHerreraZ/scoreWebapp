import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../common/dto/pagination.dto.js';

/**
 * Filtros del listado de corridas archivadas del banco de pruebas. `search`
 * (heredado) filtra por NOMBRE DEL ARCHIVO: es la llave con la que se busca una
 * corrida sin tener que volver a subir el PDF.
 */
export class FilterPdfExtractionTestDto extends PaginationDto {
  @ApiPropertyOptional({
    example: 'estados-financieros-acme.pdf',
    description:
      'Filtra por nombre del archivo PDF (contiene, sin distinguir mayúsculas)',
  })
  declare search?: string;
}
