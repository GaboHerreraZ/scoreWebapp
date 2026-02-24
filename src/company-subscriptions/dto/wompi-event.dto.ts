import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsObject,
  ValidateNested,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';

class WompiTransactionData {
  @ApiProperty()
  @IsString()
  id: string;

  @ApiProperty()
  @IsNumber()
  amount_in_cents: number;

  @ApiProperty()
  @IsString()
  reference: string;

  @ApiProperty()
  @IsString()
  currency: string;

  @ApiProperty()
  @IsString()
  status: string;
}

class WompiEventData {
  @ApiProperty()
  @ValidateNested()
  @Type(() => WompiTransactionData)
  transaction: WompiTransactionData;
}

class WompiSignature {
  @ApiProperty()
  @IsArray()
  @IsString({ each: true })
  properties: string[];

  @ApiProperty()
  @IsString()
  checksum: string;
}

export class WompiEventDto {
  @ApiProperty()
  @IsString()
  event: string;

  @ApiProperty()
  @IsObject()
  @ValidateNested()
  @Type(() => WompiEventData)
  data: WompiEventData;

  @ApiProperty()
  @IsString()
  environment: string;

  @ApiProperty()
  @ValidateNested()
  @Type(() => WompiSignature)
  signature: WompiSignature;

  @ApiProperty()
  @IsNumber()
  timestamp: number;

  @ApiProperty()
  @IsString()
  sent_at: string;
}
