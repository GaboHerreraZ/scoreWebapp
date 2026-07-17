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

class ContractStatusDto {
  @ApiProperty({
    example: false,
    description:
      'True solo si el contrato macro está firmado (signedAt). Mientras sea false, las rutas operativas responden 403.',
  })
  isSigned: boolean;

  @ApiProperty({
    enum: ['not_sent', 'pending_contract', 'signed', 'refused', 'expired'],
    example: 'pending_contract',
    description:
      "'not_sent' = aún no se ha generado el documento; el resto son códigos de company_contract_status.",
  })
  status: string;

  @ApiPropertyOptional({ example: 'Pendiente de firma' })
  statusLabel?: string;

  @ApiPropertyOptional({
    example: 'https://app.zapsign.co/verificar/doc/abc123',
    description:
      'URL de firma en Zapsign a la que redirigir cuando isSigned=false.',
  })
  signUrl?: string;

  @ApiPropertyOptional()
  sentAt?: Date;

  @ApiPropertyOptional()
  signedAt?: Date;

  @ApiPropertyOptional()
  refusedAt?: Date;

  @ApiPropertyOptional({ description: 'Motivo del cliente al rechazar.' })
  refusedReason?: string;
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
    enum: ['no_pack', 'payment_pending', 'pending_contract', 'ready'],
    example: 'pending_contract',
    description:
      "Estado de onboarding para el enrutamiento post-login: 'no_pack' (nunca compró → elegir plan), 'payment_pending' (pagó/inició compra, esperando confirmación del webhook → pantalla de pago en proceso, sin ofrecer comprar de nuevo), 'pending_contract' (bolsa activa pero contrato macro sin firmar → redirigir a contract.signUrl de Zapsign), 'ready' (bolsa activa + contrato firmado → dashboard).",
  })
  onboardingStatus?:
    | 'no_pack'
    | 'payment_pending'
    | 'pending_contract'
    | 'ready';

  @ApiPropertyOptional({
    type: ContractStatusDto,
    description:
      'Estado del contrato macro de la empresa. El front redirige a signUrl cuando isSigned=false.',
  })
  contract?: ContractStatusDto;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
