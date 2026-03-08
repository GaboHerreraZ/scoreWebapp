import { IsUUID, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCompanySubscriptionDto {
  @ApiProperty({
    example: 'uuid-de-suscripcion',
    description: 'ID del plan de suscripción',
  })
  @IsUUID()
  subscriptionId: string;

  @ApiPropertyOptional({
    example: 'uuid-de-campaña',
    description: 'ID de la campaña aplicada (si existe)',
  })
  @IsOptional()
  @IsUUID()
  campaignId?: string;
}
