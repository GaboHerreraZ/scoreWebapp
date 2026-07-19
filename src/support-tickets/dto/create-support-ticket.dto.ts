import {
  IsIn,
  IsString,
  IsOptional,
  IsObject,
  MaxLength,
  MinLength,
  ValidateIf,
  IsNotEmpty,
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
export const SUPPORT_RELATED_ENTITIES = [
  'credit_study',
  'customer',
  'payment',
] as const;

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

  // Registro relacionado: ambos null o ambos presentes. Si se manda uno, el otro
  // es obligatorio (espejo del CHECK de BD).
  @ApiPropertyOptional({ enum: SUPPORT_RELATED_ENTITIES, nullable: true })
  @IsOptional()
  @ValidateIf((o) => o.relatedEntityType !== null)
  @IsIn(SUPPORT_RELATED_ENTITIES)
  relatedEntityType?: (typeof SUPPORT_RELATED_ENTITIES)[number] | null;

  @ApiPropertyOptional({ example: '123', nullable: true })
  @ValidateIf((o) => o.relatedEntityType != null || o.relatedEntityId != null)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  relatedEntityId?: string | null;

  @ApiPropertyOptional({
    description:
      'Contexto técnico del front (appRoute, userAgent, viewport...)',
  })
  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}
