import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RejectInvitationDto {
  @ApiProperty({
    example: 'abc123...',
    description: 'Token de seguridad de la invitación',
  })
  @IsString()
  token: string;
}
