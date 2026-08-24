import { IsInt, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Datos de ficha del usuario del portal, comunes a crear y editar. Todos
 * OBLIGATORIOS: el equipo interno necesita ficha completa (contratos y pago de
 * comisiones a los vendedores), así que no se admiten altas a medias.
 *
 * En BD siguen siendo nullable a propósito: las cuentas creadas antes de estas
 * columnas tienen NULL y no se les inventó un documento para poder migrar. Esas
 * quedan completas la primera vez que alguien las edite.
 *
 * El departamento no se pide: se deriva del municipio (cityCode).
 */
export class PlatformAdminProfileDto {
  @ApiProperty({ description: 'Apellidos', example: 'Gómez Rojas' })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  lastName!: string;

  @ApiProperty({
    description: "Tipo de documento (Parameter 'identification_type')",
    example: 104,
  })
  @IsInt()
  identificationTypeId!: number;

  @ApiProperty({ description: 'Número de documento', example: '1035851234' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  identificationNumber!: string;

  @ApiProperty({ description: 'Dirección', example: 'Calle 10 #30-45' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  address!: string;

  @ApiProperty({
    description:
      'Código DANE del municipio (dane_cities). El departamento sale de ahí.',
    example: '05001',
  })
  @IsString()
  @MinLength(5)
  @MaxLength(5)
  cityCode!: string;
}
