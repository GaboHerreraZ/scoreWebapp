import {
  IsEmail,
  IsString,
  IsInt,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PlatformAdminProfileDto } from './platform-admin-profile.dto.js';

/** Datos para crear un usuario del portal (Supabase Auth + PlatformAdmin). */
export class CreatePlatformAdminDto extends PlatformAdminProfileDto {
  @ApiProperty({
    description: 'Correo del usuario',
    example: 'maria@creditia.co',
  })
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty({
    description: 'Contraseña inicial (mín. 8 caracteres)',
    example: 'Cr3d1t1a*2026',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @ApiProperty({ description: 'Nombre del usuario', example: 'María Gómez' })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name!: string;

  @ApiProperty({ description: 'Teléfono', example: '+573001234567' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  phone!: string;

  @ApiProperty({
    description:
      'Id del rol del equipo interno (Parameter platform_admin_role)',
    example: 70,
  })
  @IsInt()
  roleId!: number;
}
