import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PurchasePackDto {
  @ApiProperty({
    description: 'ID de la oferta del catálogo que se quiere comprar',
    example: 'b3f1c2d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d',
  })
  @IsUUID()
  packOfferingId: string;
}
