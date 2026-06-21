import {
  IsEmail,
  IsString,
  IsInt,
  IsOptional,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Datos para crear un usuario del portal (Supabase Auth + PlatformAdmin). */
export class CreatePlatformAdminDto {
  @ApiProperty({ description: 'Correo del usuario', example: 'maria@creditia.co' })
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

  @ApiPropertyOptional({ description: 'Teléfono', example: '+573001234567' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiProperty({
    description: 'Id del rol del equipo interno (Parameter platform_admin_role)',
    example: 70,
  })
  @IsInt()
  roleId!: number;
}
