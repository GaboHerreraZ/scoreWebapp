import { IsOptional, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { PaginationDto } from '../../common/dto/pagination.dto.js';

export class FilterConsultationPriceDto extends PaginationDto {
  @ApiPropertyOptional({ example: true, description: 'Filter by active flag' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: 'Filter by promotional (discount) prices',
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  hasDiscount?: boolean;
}
