import { IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Con qué ítem del catálogo se factura una oferta. null desvincula. */
export class SetOfferingItemDto {
  @ApiPropertyOptional({
    description:
      'Id del ítem facturable. null desvincula la oferta (y deja de poderse facturar).',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  einvoiceItemId?: string | null;
}
