import { ApiProperty } from '@nestjs/swagger';

// DTO unificado de respuesta para GET .../customers/:id.
//
// El Customer puede ser Persona Natural (PN) o Persona Jurídica (PJ), y cada uno
// trae datos distintos. Este DTO declara TODOS los campos: los que solo aplican a
// PN o solo a PJ van como opcionales/nullable (se envían null cuando no aplican).
//
//   - Comunes .......... siempre presentes
//   - demographics ..... solo PN (birthDate, gender, ageRange, ...)
//   - verificationDigit  solo PJ (dígito de verificación del NIT)
//   - bureauProfile .... solo PJ (perfil del bureau: matrícula, rep. legal, socios...)
//
// Discriminador: personType.label === 'PN' | 'PJ'.

// ─── Parámetro de lookup (personType, identificationType, economicActivity) ───
class ParameterRefDto {
  @ApiProperty({ example: 42 })
  id!: number;

  @ApiProperty({ example: 'PJ', nullable: true })
  code!: string | null;

  @ApiProperty({ example: 'Persona Jurídica' })
  label!: string;
}

// ─── Persona del bureauProfile (rep. legal, junta, revisoría, socios) ─────────
class BureauPersonDto {
  @ApiProperty({ nullable: true })
  documentType!: string | null;

  @ApiProperty({ nullable: true })
  documentNumber!: string | null;

  @ApiProperty({ nullable: true })
  name!: string | null;

  @ApiProperty({ nullable: true })
  lastName!: string | null;

  @ApiProperty({ nullable: true })
  role!: string | null;

  @ApiProperty({ nullable: true })
  appointmentDate!: string | null;

  @ApiProperty({ nullable: true })
  status!: string | null;

  @ApiProperty({ nullable: true, description: '% de participación (socios)' })
  participation!: string | null;
}

// ─── Sub-bloques del bureauProfile (solo PJ) ──────────────────────────────────
class BureauGeneralProfileDto {
  @ApiProperty({ nullable: true })
  legalOrganization!: string | null;

  @ApiProperty({ nullable: true, description: 'Tabla 5' })
  legalOrganizationLabel!: string | null;

  @ApiProperty({ nullable: true })
  ciiuCode!: string | null;

  @ApiProperty({ nullable: true })
  economicActivity!: string | null;

  @ApiProperty({ nullable: true })
  employeeCount!: string | null;

  @ApiProperty({ nullable: true })
  employeeRange!: string | null;

  @ApiProperty({ nullable: true, description: 'embargos' })
  seized!: string | null;

  @ApiProperty({ nullable: true, description: 'Tabla 6' })
  seizedLabel!: string | null;

  @ApiProperty({ nullable: true })
  inLiquidation!: string | null;

  @ApiProperty({ nullable: true, description: 'Tabla 7' })
  inLiquidationLabel!: string | null;

  @ApiProperty({ nullable: true })
  incorporationDate!: string | null;

  @ApiProperty({ nullable: true })
  authorizedCapital!: string | null;

  @ApiProperty({ nullable: true })
  subscribedCapital!: string | null;

  @ApiProperty({ nullable: true })
  paidCapital!: string | null;
}

class BureauRegistrationDto {
  @ApiProperty({ nullable: true })
  number!: string | null;

  @ApiProperty({ nullable: true })
  chamberOfCommerce!: string | null;

  @ApiProperty({ nullable: true })
  incorporation!: string | null;

  @ApiProperty({ nullable: true })
  lastRenewal!: string | null;

  @ApiProperty({ nullable: true })
  status!: string | null;
}

class BureauPeopleGroupDto {
  @ApiProperty({ type: [BureauPersonDto] })
  main!: BureauPersonDto[];

  @ApiProperty({ type: [BureauPersonDto] })
  alternates!: BureauPersonDto[];
}

class BureauStatutoryAuditorsDto {
  @ApiProperty({ type: [BureauPersonDto] })
  main!: BureauPersonDto[];

  @ApiProperty({ type: [BureauPersonDto] })
  alternates!: BureauPersonDto[];

  @ApiProperty({ type: BureauPersonDto, nullable: true })
  auditFirm!: BureauPersonDto | null;
}

class BureauPartnersDto {
  @ApiProperty({ type: [BureauPersonDto] })
  list!: BureauPersonDto[];

  @ApiProperty({ nullable: true })
  totalContributions!: string | null;
}

class BureauContactDto {
  @ApiProperty({ nullable: true })
  address!: string | null;

  @ApiProperty({ nullable: true })
  phone!: string | null;

  @ApiProperty({ nullable: true })
  city!: string | null;

  @ApiProperty({ nullable: true })
  email!: string | null;
}

// ─── bureauProfile completo (solo PJ) ─────────────────────────────────────────
class BureauProfileDto {
  @ApiProperty({ type: BureauGeneralProfileDto, nullable: true })
  generalProfile!: BureauGeneralProfileDto | null;

  @ApiProperty({ type: BureauRegistrationDto, nullable: true })
  registration!: BureauRegistrationDto | null;

  @ApiProperty({ type: BureauPeopleGroupDto, nullable: true })
  legalRep!: BureauPeopleGroupDto | null;

  @ApiProperty({ type: BureauPeopleGroupDto, nullable: true })
  board!: BureauPeopleGroupDto | null;

  @ApiProperty({ type: BureauStatutoryAuditorsDto, nullable: true })
  statutoryAuditors!: BureauStatutoryAuditorsDto | null;

  @ApiProperty({ type: BureauPartnersDto, nullable: true })
  partners!: BureauPartnersDto | null;

  @ApiProperty({ type: BureauContactDto, nullable: true })
  contact!: BureauContactDto | null;
}

// ─── Datos demográficos (solo PN) ─────────────────────────────────────────────
class CustomerDemographicsDto {
  @ApiProperty({ nullable: true, type: String, format: 'date' })
  birthDate!: Date | null;

  @ApiProperty({ nullable: true })
  birthCity!: string | null;

  @ApiProperty({ nullable: true })
  gender!: string | null;

  @ApiProperty({ nullable: true })
  ageRange!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'estadoDocumento: Vigente, Cancelada...',
  })
  documentStatus!: string | null;
}

// ─── Nombres desglosados (solo PN) ────────────────────────────────────────────
class CustomerNamePartsDto {
  @ApiProperty({ nullable: true })
  firstName!: string | null;

  @ApiProperty({ nullable: true })
  secondName!: string | null;

  @ApiProperty({ nullable: true })
  firstLastName!: string | null;

  @ApiProperty({ nullable: true })
  secondLastName!: string | null;
}

// ─── Representante legal (columnas editables; solo PJ) ────────────────────────
// No confundir con bureauProfile.legalRep (informativo, se refresca por consulta).
class CustomerLegalRepDto {
  @ApiProperty({ nullable: true })
  name!: string | null;

  @ApiProperty({ type: ParameterRefDto, nullable: true })
  identificationType!: ParameterRefDto | null;

  @ApiProperty({ nullable: true })
  identificationNumber!: string | null;

  @ApiProperty({ nullable: true })
  email!: string | null;

  @ApiProperty({ nullable: true })
  phone!: string | null;
}

// ─── Autorización del titular (habeas data + tratamiento de datos) ────────────
// Se llavea por identidad, no por customerId: se firma ANTES de que el Customer
// exista (nace de la consulta al bureau, que exige esta firma).
class CustomerAuthorizationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    nullable: true,
    description: "'pending' | 'signed' | 'refused'",
  })
  status!: string | null;

  @ApiProperty({ nullable: true })
  statusLabel!: string | null;

  @ApiProperty({ description: 'Firmada y no revocada' })
  isSigned!: boolean;

  @ApiProperty({
    nullable: true,
    description: 'URL de firma (si está pendiente)',
  })
  signUrl!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  sentAt!: Date | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  signedAt!: Date | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  refusedAt!: Date | null;

  @ApiProperty({ nullable: true })
  refusedReason!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  revokedAt!: Date | null;

  @ApiProperty({
    nullable: true,
    description:
      'Enlace de descarga del PDF firmado (URL temporal, vigencia 1 hora); null si aún no se ha firmado',
  })
  documentUrl!: string | null;
}

// ─── DTO raíz ─────────────────────────────────────────────────────────────────
export class CustomerDetailResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  companyId!: string;

  @ApiProperty({ type: ParameterRefDto, description: "'PN' | 'PJ'" })
  personType!: ParameterRefDto;

  @ApiProperty({ type: ParameterRefDto, nullable: true })
  identificationType!: ParameterRefDto | null;

  @ApiProperty({
    description: 'Razón social (PJ) o nombre completo (PN)',
  })
  businessName!: string;

  @ApiProperty()
  identificationNumber!: string;

  @ApiProperty({
    nullable: true,
    description: 'Dígito de verificación del NIT (solo PJ)',
  })
  verificationDigit!: string | null;

  @ApiProperty({ type: ParameterRefDto, nullable: true })
  economicActivity!: ParameterRefDto | null;

  // ── Nombres desglosados (solo PN; null en PJ) ──
  @ApiProperty({
    type: CustomerNamePartsDto,
    nullable: true,
    description: 'Solo PN; null en PJ',
  })
  nameParts!: CustomerNamePartsDto | null;

  // ── Contacto ──
  @ApiProperty({ nullable: true })
  email!: string | null;

  @ApiProperty({ nullable: true })
  phone!: string | null;

  @ApiProperty({ nullable: true, description: 'Código DANE del municipio' })
  cityCode!: string | null;

  /** Nombre del municipio; cae al texto de la central si aún no hay código. */
  @ApiProperty({ nullable: true })
  city!: string | null;

  /** Departamento derivado del código; null si la ciudad viene de la central. */
  @ApiProperty({ nullable: true })
  state!: string | null;

  @ApiProperty({ nullable: true })
  address!: string | null;

  // ── Representante legal (columnas editables; solo PJ, null si no hay dato) ──
  @ApiProperty({
    type: CustomerLegalRepDto,
    nullable: true,
    description:
      'Representante legal editable (columnas del Customer); null si ningún campo tiene valor',
  })
  legalRep!: CustomerLegalRepDto | null;

  // ── Demográficos (solo PN; null en PJ) ──
  @ApiProperty({
    type: CustomerDemographicsDto,
    nullable: true,
    description: 'Solo PN; null en PJ',
  })
  demographics!: CustomerDemographicsDto | null;

  // ── Perfil del bureau (solo PJ; null en PN) ──
  @ApiProperty({
    type: BureauProfileDto,
    nullable: true,
    description: 'Solo PJ; null en PN',
  })
  bureauProfile!: BureauProfileDto | null;

  // ── Autorización del titular (null si nunca se solicitó) ──
  @ApiProperty({
    type: CustomerAuthorizationDto,
    nullable: true,
    description:
      'Autorización de habeas data firmada por el titular; null si nunca se solicitó',
  })
  authorization!: CustomerAuthorizationDto | null;

  // ── Trazabilidad de la consulta ──
  @ApiProperty({ description: 'Nació de una consulta al bureau' })
  bureauCreated!: boolean;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  lastConsultedAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}
