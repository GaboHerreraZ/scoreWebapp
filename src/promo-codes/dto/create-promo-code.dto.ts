import {
  IsString,
  IsIn,
  IsNumber,
  IsInt,
  IsOptional,
  IsBoolean,
  IsUUID,
  IsDateString,
  Min,
  Max,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePromoCodeDto {
  @ApiProperty({
    description: 'Código que escribe el usuario (se normaliza a MAYÚSCULAS)',
    example: 'CREDITIA15',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  code!: string;

  @ApiProperty({
    description: 'Alcance del código',
    enum: ['company', 'global'],
    example: 'global',
  })
  @IsIn(['company', 'global'])
  scope!: 'company' | 'global';

  @ApiPropertyOptional({
    description:
      'A qué compra aplica. Default "any". Un código financiado por un ' +
      'vendedor siempre es "first_purchase" (se fuerza).',
    enum: ['any', 'first_purchase'],
    example: 'any',
  })
  @IsOptional()
  @IsIn(['any', 'first_purchase'])
  appliesTo?: 'any' | 'first_purchase';

  @ApiPropertyOptional({
    description:
      'Quién paga el descuento. "creditia" sale del margen; "sales_rep" se ' +
      'resta de la comisión de quien crea el código. Un vendedor solo puede ' +
      '"sales_rep"; un admin sin ficha de vendedor solo "creditia". Quien es ' +
      'ambas cosas debe elegir (default "creditia").',
    enum: ['creditia', 'sales_rep'],
    example: 'creditia',
  })
  @IsOptional()
  @IsIn(['creditia', 'sales_rep'])
  fundedBy?: 'creditia' | 'sales_rep';

  @ApiPropertyOptional({
    description:
      'Empresa a la que se ata el código. Requerido si scope=company.',
    example: '4cc725de-1919-4228-b4ff-161a32b1be5b',
  })
  @ValidateIf((o) => o.scope === 'company')
  @IsUUID()
  companyId?: string;

  @ApiProperty({
    description: 'Porcentaje de descuento (1-100)',
    example: 15,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100)
  discountPercent!: number;

  @ApiPropertyOptional({
    description:
      'Cantidad de canjes permitidos. Para scope=company se fuerza a 1; ' +
      'para scope=global es el cupo total (default 1).',
    example: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedemptions?: number;

  @ApiPropertyOptional({ description: 'Inicio de validez (ISO). Opcional.' })
  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @ApiPropertyOptional({ description: 'Fin de validez (ISO). Opcional.' })
  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @ApiPropertyOptional({ description: 'Activo al crear (default true)' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Nota interna (campaña, cliente, etc.)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}
