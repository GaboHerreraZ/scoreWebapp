import { IsOptional, IsBoolean, IsInt, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { PaginationDto } from '../../common/dto/pagination.dto.js';

export class FilterSubscriptionDto extends PaginationDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    example: 1,
    description: 'Filter by dashboard level parameter ID',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  dashboardLevelId?: number;

  @ApiPropertyOptional({
    example: 1,
    description: 'Filter by support level parameter ID',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  supportLevelId?: number;

  @ApiPropertyOptional({
    example: true,
    description: 'Filter by billing cycle: true = monthly, false = annual',
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isMonthly?: boolean;
}
