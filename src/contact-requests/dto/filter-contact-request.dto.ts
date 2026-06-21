import { IsOptional, IsString, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../common/dto/pagination.dto.js';
import { CONTACT_SUBJECTS } from './create-contact-request.dto.js';

export class FilterContactRequestDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Filtrar por estado (code)',
    enum: ['new', 'in_progress', 'closed'],
  })
  @IsOptional()
  @IsIn(['new', 'in_progress', 'closed'])
  status?: string;

  @ApiPropertyOptional({
    description: 'Filtrar por asunto (code)',
    enum: CONTACT_SUBJECTS,
  })
  @IsOptional()
  @IsString()
  subject?: string;
}
