import { IsOptional, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListSubscriptionsDto {
  @ApiPropertyOptional({
    enum: ['all'],
    description:
      "Alcance del listado. 'all' devuelve TODOS los planes (vigentes, legados y desactivados), para administración. Sin valor: solo el catálogo vigente.",
  })
  @IsOptional()
  @IsIn(['all'])
  scope?: 'all';
}
