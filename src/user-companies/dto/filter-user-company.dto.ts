import { IsOptional, IsInt, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { PaginationDto } from '../../common/dto/pagination.dto.js';

export class FilterUserCompanyDto extends PaginationDto {
  @ApiPropertyOptional({ example: 1, description: 'Filtrar por roleId' })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  roleId?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isActive?: boolean;
}
