import { IsInt, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateUserCompanyDto {
  @ApiProperty({ example: 'uuid-del-usuario' })
  @IsUUID()
  userId: string;

  @ApiProperty({ example: 1, description: 'ID del parámetro de rol (type=user_company_role)' })
  @IsInt()
  roleId: number;
}
