import {
  IsIn,
  IsString,
  IsEmail,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export const CONTACT_SUBJECTS = [
  'demo',
  'pricing',
  'integration',
  'volume',
  'support',
  'other',
] as const;

export type ContactSubject = (typeof CONTACT_SUBJECTS)[number];

/** Payload del formulario público de contacto comercial. */
export class CreateContactRequestDto {
  @ApiProperty({
    description: 'Asunto del contacto',
    enum: CONTACT_SUBJECTS,
    example: 'demo',
  })
  @IsIn(CONTACT_SUBJECTS)
  subject!: ContactSubject;

  @ApiProperty({ description: 'Nombre de la empresa', example: 'Acme S.A.S.' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  companyName!: string;

  @ApiProperty({ description: 'Nombre de la persona', example: 'Juan Pérez' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fullName!: string;

  @ApiProperty({ description: 'Correo de contacto', example: 'juan@acme.co' })
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty({
    description: 'Teléfono internacional',
    example: '+573001234567',
  })
  @IsString()
  @MinLength(5)
  @MaxLength(50)
  phone!: string;

  @ApiProperty({
    description: 'Mensaje (máx. 1000 caracteres)',
    example: 'Queremos ver una demo, hacemos ~200 consultas/mes.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  message!: string;
}
