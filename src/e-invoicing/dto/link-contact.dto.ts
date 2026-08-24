import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Vincula la empresa con un tercero que YA existe en el facturador. */
export class LinkContactDto {
  @ApiProperty({
    description:
      'Identificador del tercero en el facturador (el `ref` que devuelve la búsqueda)',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  contactRef: string;
}
