import {
  IsString,
  IsUUID,
  IsOptional,
  IsEmail,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

class CardDto {
  @ApiProperty({ example: '4575623182290326' })
  @IsString()
  cardNumber: string;

  @ApiProperty({ example: 'Gabriel Herrera' })
  @IsString()
  @MaxLength(150)
  cardName: string;

  @ApiProperty({ example: '123' })
  @IsString()
  @MaxLength(4)
  cvc: string;

  @ApiProperty({ example: '06' })
  @IsString()
  @MaxLength(2)
  expMonth: string;

  @ApiProperty({ example: '2028' })
  @IsString()
  @MaxLength(4)
  expYear: string;
}

class BillingDto {
  @ApiProperty({ example: 'Gabriel', maxLength: 150 })
  @IsString()
  @MaxLength(150)
  name: string;

  @ApiProperty({ example: 'Herrera', maxLength: 150 })
  @IsString()
  @MaxLength(150)
  lastName: string;

  @ApiProperty({ example: 'CC', description: 'Document type code (CC, CE, NIT, etc.)' })
  @IsString()
  @MaxLength(10)
  docType: string;

  @ApiProperty({ example: '1035851234', maxLength: 50 })
  @IsString()
  @MaxLength(50)
  docNumber: string;

  @ApiProperty({ example: 'herzar_620@hotmail.com', maxLength: 255 })
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({ example: 'Calle 10 #30-45', maxLength: 255 })
  @IsString()
  @MaxLength(255)
  address: string;

  @ApiProperty({ example: 'Antioquia', maxLength: 150 })
  @IsString()
  @MaxLength(150)
  state: string;

  @ApiProperty({ example: 'Medellín', maxLength: 150 })
  @IsString()
  @MaxLength(150)
  city: string;

  @ApiProperty({ example: '+573001234567', maxLength: 50 })
  @IsString()
  @MaxLength(50)
  phone: string;
}

export class SubscribeDto {
  @ApiProperty({
    example: 'uuid-del-plan',
    description: 'ID of the subscription plan in your DB',
  })
  @IsUUID()
  subscriptionId: string;

  @ApiProperty({ type: CardDto })
  @ValidateNested()
  @Type(() => CardDto)
  card: CardDto;

  @ApiProperty({ type: BillingDto })
  @ValidateNested()
  @Type(() => BillingDto)
  billing: BillingDto;

  @ApiPropertyOptional({
    example: 'uuid-de-campaña',
    description: 'Campaign ID for discount (optional)',
  })
  @IsOptional()
  @IsUUID()
  campaignId?: string;
}
