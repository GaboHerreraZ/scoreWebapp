import {
  IsString,
  IsOptional,
  IsBoolean,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateSalesRepDto {
  @ApiPropertyOptional({
    description:
      'Nuevo código (MAYÚSCULAS). Cambiarlo NO afecta a las empresas ya ' +
      'vinculadas: la vinculación va por id, no por texto.',
    example: 'JPEREZ',
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[A-Za-z0-9-]+$/, {
    message: 'El código solo admite letras, números y guiones',
  })
  code?: string;

  @ApiPropertyOptional({
    description:
      'Retira al vendedor del programa (false). No borra sus comisiones ni ' +
      'desvincula sus empresas.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Nota interna' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
