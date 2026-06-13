import {
  IsString,
  IsUUID,
  IsOptional,
  IsEmail,
  MaxLength,
  ValidateNested,
  IsNumber,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

class ChangePlanCardDto {
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

class ChangePlanBillingDto {
  @ApiProperty({ example: 'Gabriel', maxLength: 150 })
  @IsString()
  @MaxLength(150)
  name: string;

  @ApiProperty({ example: 'Herrera', maxLength: 150 })
  @IsString()
  @MaxLength(150)
  lastName: string;

  @ApiProperty({ example: 'CC' })
  @IsString()
  @MaxLength(10)
  docTypeCode: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  docType: number;

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

export class ChangePlanDto {
  @ApiProperty({ description: 'ID del nuevo plan al que se quiere cambiar' })
  @IsUUID()
  subscriptionId: string;

  @ApiPropertyOptional({
    type: ChangePlanCardDto,
    description:
      'Tarjeta de crédito. Requerida si la empresa no tiene un cliente ePayco previo. Opcional si se quiere reemplazar la tarjeta actual.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChangePlanCardDto)
  card?: ChangePlanCardDto;

  @ApiPropertyOptional({
    type: ChangePlanBillingDto,
    description:
      'Datos de facturación. Requeridos si la empresa no tiene un cliente ePayco previo. Opcional para reemplazar los datos actuales.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChangePlanBillingDto)
  billing?: ChangePlanBillingDto;
}
