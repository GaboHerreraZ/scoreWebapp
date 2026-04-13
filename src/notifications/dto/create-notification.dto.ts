import { IsString, IsInt, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateNotificationDto {
  @ApiProperty({ example: 'company-uuid', description: 'Company ID' })
  @IsUUID()
  companyId: string;

  @ApiProperty({ example: 1, description: 'Notification type parameter ID' })
  @Type(() => Number)
  @IsInt()
  typeId: number;

  @ApiProperty({ example: 'Pagaré firmado', description: 'Short title' })
  @IsString()
  title: string;

  @ApiProperty({
    example: 'Gabriel Herrera firmó el pagaré del estudio de crédito #123',
    description: 'Notification message',
  })
  @IsString()
  message: string;

  @ApiProperty({
    example: '/app/credit-study/detail/abc-123',
    description: 'Frontend route to navigate on click',
  })
  @IsString()
  route: string;
}
