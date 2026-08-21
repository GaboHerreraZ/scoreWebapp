import { IsString, IsOptional, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Vincula (o reasigna) una empresa al vendedor que la recomendó. */
export class AssignReferralDto {
  @ApiProperty({
    description: 'Código del vendedor que trajo la empresa',
    example: 'JPEREZ',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  code!: string;

  @ApiPropertyOptional({ description: 'Nota interna de la vinculación' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
