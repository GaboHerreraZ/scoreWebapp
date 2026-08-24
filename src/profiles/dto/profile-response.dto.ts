import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class RoleDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'ROLE' })
  type: string;

  @ApiProperty({ example: 'ADMIN' })
  code: string;

  @ApiProperty({ example: 'Administrador' })
  label: string;

  @ApiPropertyOptional({ example: 'Rol de administrador del sistema' })
  description?: string;
}

export class ProfileResponseDto {
  @ApiProperty({ example: 'uuid-de-supabase' })
  id: string;

  @ApiProperty({ example: 'usuario@correo.com' })
  email: string;

  @ApiPropertyOptional({ example: 'Juan' })
  name?: string;

  @ApiPropertyOptional({ example: 'Pérez' })
  lastName?: string;

  @ApiPropertyOptional({ example: '3001234567' })
  phone?: string;

  @ApiPropertyOptional({ example: 1 })
  roleId?: number;

  @ApiPropertyOptional({ example: 'Gerente comercial' })
  position?: string;

  @ApiPropertyOptional({ type: RoleDto })
  role?: RoleDto;

  @ApiPropertyOptional({
    example: false,
    description:
      'Onboarding listo: true cuando la empresa tiene perfil + empresa + primer pack pagado (active). false = quedó pendiente en algún paso.',
  })
  isOnboardingReady?: boolean;

  @ApiPropertyOptional({
    enum: ['no_pack', 'payment_pending', 'ready'],
    example: 'ready',
    description:
      "Estado de onboarding para el enrutamiento post-login: 'no_pack' (nunca compró → elegir plan), 'payment_pending' (pagó/inició compra, esperando confirmación del webhook → pantalla de pago en proceso, sin ofrecer comprar de nuevo), 'ready' (bolsa activa → dashboard).",
  })
  onboardingStatus?: 'no_pack' | 'payment_pending' | 'ready';

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
