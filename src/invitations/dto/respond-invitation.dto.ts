import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RespondInvitationDto {
  @ApiProperty({ example: true, description: 'true para aceptar, false para rechazar' })
  @IsBoolean()
  accept: boolean;
}
