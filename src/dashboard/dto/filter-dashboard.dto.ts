import { IsOptional, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class FilterDashboardDto {
  @ApiPropertyOptional({
    example: '2026-01-01',
    description: 'Start of analysis period',
  })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({
    example: '2026-12-31',
    description: 'End of analysis period',
  })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
