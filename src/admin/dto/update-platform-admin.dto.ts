import { IsInt, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PlatformAdminProfileDto } from './platform-admin-profile.dto.js';

/**
 * Edición de un usuario del portal. Reemplaza la ficha completa: todos los
 * campos son obligatorios, igual que al crear. El email y la contraseña no se
 * editan aquí (tocarían Supabase Auth) y el isActive va por su propio endpoint.
 *
 * Es un PATCH que se comporta como reemplazo total del perfil, a propósito: el
 * portal siempre envía el formulario entero, y admitir envíos parciales dejaría
 * volver a tener fichas incompletas por la puerta de atrás.
 */
export class UpdatePlatformAdminDto extends PlatformAdminProfileDto {
  @ApiProperty({ description: 'Nombres del usuario' })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name!: string;

  @ApiProperty({ description: 'Teléfono' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  phone!: string;

  @ApiProperty({ description: 'Id del rol (Parameter platform_admin_role)' })
  @IsInt()
  roleId!: number;
}
