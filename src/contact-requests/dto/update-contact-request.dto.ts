import { IsOptional, IsIn, IsUUID, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Gestión de un lead desde el panel admin: cambiar estado, asignar a un admin
 * y/o agregar notas. Al pasar a 'closed' se registra quién y cuándo (handledBy/
 * handledAt). Los datos del formulario son inmutables.
 */
export class UpdateContactRequestDto {
  @ApiPropertyOptional({
    description: 'Nuevo estado (code)',
    enum: ['new', 'in_progress', 'closed'],
  })
  @IsOptional()
  @IsIn(['new', 'in_progress', 'closed'])
  status?: string;

  @ApiPropertyOptional({
    description: 'PlatformAdmin asignado para atender el lead (o null)',
  })
  @IsOptional()
  @IsUUID()
  assignedTo?: string;

  @ApiPropertyOptional({ description: 'Notas internas de gestión' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
