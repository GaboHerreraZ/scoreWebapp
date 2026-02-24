import {
  IsString,
  IsOptional,
  IsEmail,
  IsUUID,
  IsInt,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProfileDto {
  @ApiProperty({ example: 'uuid-de-supabase' })
  @IsUUID()
  id: string;

  @ApiProperty({ example: 'usuario@correo.com', maxLength: 255 })
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiPropertyOptional({ example: 'Juan', maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({ example: 'Pérez', maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  lastName?: string;

  @ApiPropertyOptional({ example: '3001234567', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional({ example: 1, description: 'Parameter ID for role' })
  @IsOptional()
  @IsInt()
  roleId?: number;

  @ApiPropertyOptional({ example: 'Gerente comercial', maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  position?: string;

}
