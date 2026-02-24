import { IsInt, IsOptional, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserCompanyDto {
  @ApiPropertyOptional({ example: 1, description: 'ID del parámetro de rol (type=user_company_role)' })
  @IsOptional()
  @IsInt()
  roleId?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
