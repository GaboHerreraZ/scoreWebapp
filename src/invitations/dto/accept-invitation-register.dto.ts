import { IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AcceptInvitationRegisterDto {
  @ApiProperty({
    example: 'uuid-de-supabase',
    description: 'ID del usuario en Supabase auth.users',
  })
  @IsUUID()
  userId: string;

  @ApiProperty({
    example: 'abc123...',
    description: 'Token de seguridad de la invitación',
  })
  @IsString()
  token: string;
}
