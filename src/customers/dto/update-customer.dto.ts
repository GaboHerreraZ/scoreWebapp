import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

// Edición manual del Customer: SOLO campos que el refresh del bureau no pisa
// (fuera del set `refreshable` del upsert). Enviar null limpia el campo.
export class UpdateCustomerDto {
  @ApiPropertyOptional({
    description: 'Email de contacto (se usa para firmas, p.ej. pagaré)',
    example: 'contacto@acme.com.co',
    maxLength: 255,
    nullable: true,
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string | null;

  @ApiPropertyOptional({
    description: 'Teléfono de contacto',
    example: '3001234567',
    maxLength: 50,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string | null;

  @ApiPropertyOptional({
    description: 'Ciudad',
    example: 'Barranquilla',
    maxLength: 150,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  city?: string | null;

  @ApiPropertyOptional({
    description: 'Departamento',
    example: 'Atlántico',
    maxLength: 150,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  state?: string | null;

  @ApiPropertyOptional({
    description: 'Dirección',
    example: 'Cra 53 # 75-100 Of 301',
    maxLength: 255,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string | null;

  @ApiPropertyOptional({
    description:
      "Actividad económica: id de un Parameter tipo 'sector' activo (catálogo CIIU)",
    example: 4711,
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  economicActivityId?: number | null;

  // ── Representante legal (solo PJ) ──

  @ApiPropertyOptional({
    description: 'Nombre completo del representante legal',
    example: 'María Fernanda Gómez Ruiz',
    maxLength: 255,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  legalRepName?: string | null;

  @ApiPropertyOptional({
    description:
      "Tipo de identificación del representante legal: id de un Parameter tipo 'identification_type' activo",
    example: 11,
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  legalRepIdentificationTypeId?: number | null;

  @ApiPropertyOptional({
    description: 'Número de identificación del representante legal',
    example: '52123456',
    maxLength: 50,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  legalRepIdentificationNumber?: string | null;

  @ApiPropertyOptional({
    description:
      'Correo del representante legal (destinatario de la firma del pagaré en PJ)',
    example: 'mgomez@acme.com.co',
    maxLength: 255,
    nullable: true,
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  legalRepEmail?: string | null;

  @ApiPropertyOptional({
    description: 'Teléfono del representante legal',
    example: '3109876543',
    maxLength: 50,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  legalRepPhone?: string | null;
}
