import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCompanySubscriptionDto {
  @ApiProperty({
    example: 'uuid-de-suscripcion',
    description: 'ID del plan de suscripción',
  })
  @IsUUID()
  subscriptionId: string;
}
