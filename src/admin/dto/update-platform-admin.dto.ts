import { IsOptional, IsInt, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Edición de un usuario del portal. Solo datos del perfil + rol. El email y la
 * contraseña no se editan aquí (tocarían Supabase Auth) y el isActive se maneja
 * con el endpoint de desactivar (DELETE).
 */
export class UpdatePlatformAdminDto {
  @ApiPropertyOptional({ description: 'Nombre del usuario' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({ description: 'Teléfono' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional({
    description: 'Id del rol (Parameter platform_admin_role)',
  })
  @IsOptional()
  @IsInt()
  roleId?: number;
}
