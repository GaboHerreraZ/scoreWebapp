import {
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
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

/**
 * Pago inicial del onboarding desde la página de checkout propia. El link del
 * correo trae companySubscriptionId + token (paymentToken), que autorizan el
 * pago sin sesión. La tarjeta se tokeniza y se crea la suscripción recurrente.
 * Los datos de facturación NO se piden aquí: ya se capturaron en el onboarding
 * del admin y viven en la empresa; payOnboarding los lee de allí.
 */
export class PayOnboardingDto {
  @ApiProperty({ description: 'ID de la CompanySubscription a pagar' })
  @IsUUID()
  companySubscriptionId: string;

  @ApiProperty({ description: 'Token de pago recibido en el link del correo' })
  @IsString()
  @MaxLength(64)
  token: string;

  @ApiProperty({ type: CardDto })
  @ValidateNested()
  @Type(() => CardDto)
  card: CardDto;
}
