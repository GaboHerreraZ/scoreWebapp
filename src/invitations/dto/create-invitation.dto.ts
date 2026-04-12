import { IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateInvitationDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Correo del usuario invitado',
  })
  @IsEmail()
  email: string;
}
