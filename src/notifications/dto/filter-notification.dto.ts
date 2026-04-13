import { IsOptional, IsInt } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../common/dto/pagination.dto.js';

export class FilterNotificationDto extends PaginationDto {
  @ApiPropertyOptional({ example: 1, description: 'Filter by notification type' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  typeId?: number;
}
