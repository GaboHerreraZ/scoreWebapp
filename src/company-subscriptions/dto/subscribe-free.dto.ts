import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SubscribeFreeDto {
  @ApiProperty({
    example: 'uuid-del-plan-free',
    description: 'ID del plan gratuito',
  })
  @IsUUID()
  subscriptionId: string;
}
