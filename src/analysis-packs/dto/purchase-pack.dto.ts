import { IsUUID, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PurchasePackDto {
  @ApiProperty({
    description: 'ID de la oferta del catálogo que se quiere comprar',
    example: 'b3f1c2d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d',
  })
  @IsUUID()
  packOfferingId: string;

  @ApiPropertyOptional({
    description:
      'Path RELATIVO del front al que ePayco redirige tras el pago (ej. ' +
      '/onboarding/resultado o /panel/pagos/resultado). Debe empezar con "/". ' +
      'Si no se envía, se usa el path por defecto (/pago/resultado).',
    example: '/panel/pagos/resultado',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  redirectPath?: string;
}
