import { IsOptional, IsString, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../common/dto/pagination.dto.js';
import {
  SUPPORT_AREAS,
  SUPPORT_TYPES,
  SUPPORT_PRIORITIES,
} from './create-support-ticket.dto.js';

export class FilterSupportTicketDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ['open', 'in_progress', 'closed'] })
  @IsOptional()
  @IsIn(['open', 'in_progress', 'closed'])
  status?: string;

  @ApiPropertyOptional({ enum: SUPPORT_AREAS })
  @IsOptional()
  @IsString()
  area?: string;

  @ApiPropertyOptional({ enum: SUPPORT_TYPES })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ enum: SUPPORT_PRIORITIES })
  @IsOptional()
  @IsString()
  priority?: string;
}
