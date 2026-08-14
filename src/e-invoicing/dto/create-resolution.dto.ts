import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Alta de una resolución de facturación de la DIAN.
 *
 * Los siete campos se transcriben TAL CUAL del documento que expide la DIAN:
 * un dígito distinto en la clave técnica o en el rango invalida cada factura
 * que se emita con ella.
 */
export class CreateResolutionDto {
  @ApiProperty({
    description:
      'Ambiente en el que aplica. Una resolución de producción no sirve para pruebas ni al revés.',
    enum: ['test', 'habilitation', 'production'],
    example: 'production',
  })
  @IsIn(['test', 'habilitation', 'production'])
  environment: 'test' | 'habilitation' | 'production';

  @ApiProperty({
    description: 'Clave técnica que la DIAN entrega junto con la resolución',
    maxLength: 200,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  key: string;

  @ApiProperty({
    description: 'Prefijo autorizado de la numeración',
    example: 'SETP',
    maxLength: 10,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(10)
  prefix: string;

  @ApiProperty({
    description:
      'Número de la RESOLUCIÓN (no del documento). Se recibe como texto: excede el entero seguro de JavaScript.',
    example: '18760000001',
  })
  @Matches(/^\d{1,20}$/, {
    message: 'number debe ser un entero positivo en texto',
  })
  number: string;

  @ApiProperty({
    description: 'Primer número autorizado del rango',
    example: 1,
  })
  @IsInt()
  @Min(1)
  rangeInitial: number;

  @ApiProperty({
    description: 'Último número autorizado del rango',
    example: 5000,
  })
  @IsInt()
  @Min(1)
  rangeFinal: number;

  @ApiPropertyOptional({
    description:
      'Siguiente consecutivo a usar. Por defecto arranca en rangeInitial; se envía explícito cuando ya se emitieron facturas de esta resolución por fuera del sistema.',
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  nextConsecutive?: number;

  @ApiProperty({ description: 'Inicio de vigencia (YYYY-MM-DD)' })
  @IsDateString()
  validFrom: string;

  @ApiProperty({ description: 'Fin de vigencia (YYYY-MM-DD)' })
  @IsDateString()
  validUntil: string;
}
