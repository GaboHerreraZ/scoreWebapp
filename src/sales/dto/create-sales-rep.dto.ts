import {
  IsString,
  IsUUID,
  IsOptional,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSalesRepDto {
  @ApiProperty({
    description:
      'Cuenta del portal (PlatformAdmin) que será el vendedor. Debe tener rol sales.',
    example: '4cc725de-1919-4228-b4ff-161a32b1be5b',
  })
  @IsUUID()
  platformAdminId!: string;

  @ApiPropertyOptional({
    description:
      'Código del vendedor (se normaliza a MAYÚSCULAS). Si se omite, se ' +
      'genera a partir de su nombre.',
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

  @ApiPropertyOptional({ description: 'Nota interna (acuerdo, contacto…)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
