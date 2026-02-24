import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateTransactionDto {
  @ApiProperty({
    example: 'uuid-de-suscripcion',
    description: 'ID del plan de suscripción',
  })
  @IsUUID()
  subscriptionId: string;
}
