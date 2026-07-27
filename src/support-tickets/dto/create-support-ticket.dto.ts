import {
  IsIn,
  IsString,
  IsOptional,
  IsObject,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const SUPPORT_AREAS = [
  'credit_study',
  'customer',
  'payment',
  'account',
  'other',
] as const;
export const SUPPORT_TYPES = ['bug', 'question', 'request'] as const;
export const SUPPORT_PRIORITIES = ['low', 'medium', 'high'] as const;

export class CreateSupportTicketDto {
  @ApiProperty({ enum: SUPPORT_AREAS, example: 'credit_study' })
  @IsIn(SUPPORT_AREAS)
  area!: (typeof SUPPORT_AREAS)[number];

  @ApiProperty({ enum: SUPPORT_TYPES, example: 'bug' })
  @IsIn(SUPPORT_TYPES)
  type!: (typeof SUPPORT_TYPES)[number];

  @ApiProperty({ enum: SUPPORT_PRIORITIES, example: 'high' })
  @IsIn(SUPPORT_PRIORITIES)
  priority!: (typeof SUPPORT_PRIORITIES)[number];

  @ApiProperty({
    example: "El estudio quedó en 'En Revisión' tras cargar el PDF",
  })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  subject!: string;

  @ApiProperty({
    example: 'Cargué los estados financieros y el análisis nunca se ejecutó...',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  description!: string;

  // Vínculo por FK tipada según el área (el servicio valida la regla): área
  // credit_study exige creditStudyId (el customerId se deriva del estudio);
  // área customer exige customerId; payment/account/other no llevan id extra.
  @ApiPropertyOptional({
    description:
      'Id del estudio de crédito relacionado. Obligatorio si area=credit_study.',
    example: '274a8666-1234-4abc-9def-567890abcdef',
  })
  @IsOptional()
  @IsUUID()
  creditStudyId?: string;

  @ApiPropertyOptional({
    description: 'Id del cliente relacionado. Obligatorio si area=customer.',
    example: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
  })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({
    description:
      'Contexto técnico del front (appRoute, userAgent, viewport...)',
  })
  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}
