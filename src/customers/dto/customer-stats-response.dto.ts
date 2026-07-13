import { ApiProperty } from '@nestjs/swagger';

// DTO de respuesta para GET .../customers/:id/stats.
//
// Vistazo rápido del comportamiento crediticio del cliente DENTRO de la empresa:
// cuántos estudios ha generado, cómo le ha ido en viabilidad, cuánto pide vs.
// cuánto se le recomienda, y qué tan rápido se resuelven sus estudios. Todo se
// calcula sobre los CreditStudy del cliente en la empresa — sin histórico del
// bureau ni indicadores financieros (eso vive en sus propios módulos).

class StudyStatusCountDto {
  @ApiProperty({ example: 'confirmed' })
  code!: string;

  @ApiProperty({ example: 'Confirmado' })
  label!: string;

  @ApiProperty({ example: 3 })
  count!: number;
}

class StudiesStatsDto {
  @ApiProperty({ description: 'Total de estudios creados', example: 8 })
  total!: number;

  @ApiProperty({ nullable: true, type: String, format: 'date' })
  firstStudyDate!: Date | null;

  @ApiProperty({ nullable: true, type: String, format: 'date' })
  lastStudyDate!: Date | null;

  @ApiProperty({
    nullable: true,
    description: 'Días transcurridos desde el último estudio',
    example: 12,
  })
  daysSinceLastStudy!: number | null;

  @ApiProperty({
    type: [StudyStatusCountDto],
    description: 'Desglose por estado actual',
  })
  byStatus!: StudyStatusCountDto[];
}

class ViabilityStatsDto {
  @ApiProperty({
    description: 'Estudios con análisis de viabilidad realizado',
    example: 6,
  })
  analyzed!: number;

  @ApiProperty({ example: 4 })
  approved!: number;

  @ApiProperty({ example: 1 })
  conditional!: number;

  @ApiProperty({ example: 1 })
  rejected!: number;

  @ApiProperty({
    nullable: true,
    description: '% de aprobados sobre analizados (0-100)',
    example: 66.7,
  })
  approvalRate!: number | null;

  @ApiProperty({
    nullable: true,
    description: 'Score promedio (0-100)',
    example: 72,
  })
  avgScore!: number | null;

  @ApiProperty({
    nullable: true,
    description: 'Score del análisis más reciente',
    example: 78,
  })
  lastScore!: number | null;

  @ApiProperty({
    nullable: true,
    description: 'Estado de viabilidad del análisis más reciente',
    example: 'approved',
  })
  lastStatus!: string | null;

  @ApiProperty({
    nullable: true,
    enum: ['up', 'down', 'stable'],
    description:
      'Tendencia del score: último vs. anterior (null si hay menos de 2 análisis)',
    example: 'up',
  })
  scoreTrend!: 'up' | 'down' | 'stable' | null;
}

class AmountsStatsDto {
  @ApiProperty({
    nullable: true,
    description: 'Suma de cupos solicitados ($)',
    example: 250000000,
  })
  totalRequested!: number | null;

  @ApiProperty({ nullable: true, description: 'Cupo solicitado promedio ($)' })
  avgRequested!: number | null;

  @ApiProperty({
    nullable: true,
    description: 'Suma de cupos recomendados ($)',
    example: 180000000,
  })
  totalRecommended!: number | null;

  @ApiProperty({ nullable: true, description: 'Cupo recomendado promedio ($)' })
  avgRecommended!: number | null;

  @ApiProperty({
    nullable: true,
    description:
      '% recomendado/solicitado (0-100+). <100 ⇒ se le recomienda menos de lo que pide',
    example: 72,
  })
  recommendationRatio!: number | null;

  @ApiProperty({
    nullable: true,
    description: 'Cupo recomendado del estudio más reciente ($)',
    example: 45000000,
  })
  lastRecommendedCreditLine!: number | null;
}

class TimingStatsDto {
  @ApiProperty({
    nullable: true,
    description:
      'Días promedio entre studyDate y resolutionDate (solo estudios resueltos)',
    example: 4.5,
  })
  avgResolutionDays!: number | null;

  @ApiProperty({
    description: 'Estudios creados en los últimos 12 meses',
    example: 5,
  })
  studiesLast12Months!: number;
}

export class CustomerStatsResponseDto {
  @ApiProperty({ format: 'uuid' })
  customerId!: string;

  @ApiProperty({ type: StudiesStatsDto })
  studies!: StudiesStatsDto;

  @ApiProperty({ type: ViabilityStatsDto })
  viability!: ViabilityStatsDto;

  @ApiProperty({ type: AmountsStatsDto })
  amounts!: AmountsStatsDto;

  @ApiProperty({ type: TimingStatsDto })
  timing!: TimingStatsDto;
}
