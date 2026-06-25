import { IsOptional, IsIn, IsUUID, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Gestión de un ticket desde el panel de soporte (admin): estado, asignación a
 * un PlatformAdmin y notas internas. Los datos enviados por el cliente son
 * inmutables.
 */
export class UpdateSupportTicketDto {
  @ApiPropertyOptional({ enum: ['open', 'in_progress', 'closed'] })
  @IsOptional()
  @IsIn(['open', 'in_progress', 'closed'])
  status?: string;

  @ApiPropertyOptional({ description: 'PlatformAdmin asignado (o null)' })
  @IsOptional()
  @IsUUID()
  assignedTo?: string;

  @ApiPropertyOptional({ description: 'Notas internas de gestión' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
