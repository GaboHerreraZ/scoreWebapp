export type PersonType = 'PN' | 'PJ';

export interface ProviderConsultParams {
  docType: string; // formato del proveedor (ya traducido por resolveDocType)
  identificationNumber: string;
  apellidoRazonSocial: string;
}

// Tabla 1 — código de respuesta enriquecido con su descripción del manual.
export interface MappedResponseCode {
  clave: string | null; // 'CC' | 'SS' | 'HC' | 'DE' | 'TX'...
  valor: string | null; // '00' | '02' | '17'...
  descripcion: string | null; // solo para la clave TX (las demás no están tabuladas)
}

export interface MappedConsultationMeta {
  consultaAt: Date;
  tipoIdDigitado: string | null;
  numeroIdDigitado: string | null;
  txCode: string | null;
  codigosRespuesta: unknown; // crudo (compat)
  codigosRespuestaLabeled: MappedResponseCode[]; // Tabla 1
  conInformacion: boolean;
  personType: PersonType;
}

export interface MappedCustomer {
  identificationTypeCode: string | null; // code de Parameter 'identification_type'
  businessName: string;
  identificationNumber: string;
  verificationDigit: string | null;
  firstName: string | null;
  secondName: string | null;
  firstLastName: string | null;
  secondLastName: string | null;
  birthDate: Date | null;
  birthCity: string | null;
  gender: string | null;
  ageRange: string | null;
  documentStatus: string | null;
  // Perfil PJ (dominio). null para PN. Se guarda como JSONB en Customer.bureauProfile.
  bureauProfile: MappedBureauProfile | null;
}

// ── Perfil PJ en dominio (nombres propios, neutro al proveedor) ─────────────
export interface MappedBureauPerson {
  documentType: string | null;
  documentNumber: string | null;
  name: string | null;
  lastName: string | null;
  role: string | null;
  appointmentDate: string | null;
  status: string | null;
  participation: string | null; // % socios
}

export interface MappedBureauProfile {
  generalProfile: {
    legalOrganization: string | null;
    legalOrganizationLabel: string | null; // Tabla 5
    ciiuCode: string | null;
    economicActivity: string | null;
    employeeCount: string | null;
    employeeRange: string | null;
    seized: string | null; // embargos
    seizedLabel: string | null; // Tabla 6
    inLiquidation: string | null;
    inLiquidationLabel: string | null; // Tabla 7
    incorporationDate: string | null;
    authorizedCapital: string | null;
    subscribedCapital: string | null;
    paidCapital: string | null;
  } | null;
  registration: {
    number: string | null;
    chamberOfCommerce: string | null;
    incorporation: string | null;
    lastRenewal: string | null;
    status: string | null;
  } | null;
  legalRep: {
    main: MappedBureauPerson[];
    alternates: MappedBureauPerson[];
  } | null;
  board: {
    main: MappedBureauPerson[];
    alternates: MappedBureauPerson[];
  } | null;
  statutoryAuditors: {
    main: MappedBureauPerson[];
    alternates: MappedBureauPerson[];
    auditFirm: MappedBureauPerson | null;
  } | null;
  partners: {
    list: MappedBureauPerson[];
    totalContributions: string | null;
  } | null;
  contact: {
    address: string | null;
    phone: string | null;
    city: string | null;
    email: string | null;
  } | null;
}

// ── Bloques temporales del snapshot (cambian por consulta) ──────────────────
// Tabla 8 — tipos de crédito por cartera (PJ).
export interface MappedCreditPortfolioItem {
  tipoCredito: string | null;
  tipoCreditoLabel: string | null; // Tabla 8
  saldo: string | null;
  porcentajePart: string | null;
}

// Tabla 9 — comportamiento de pago mensual (PN + PJ).
export interface MappedPaymentBehaviorItem {
  anioMes: string | null; // 'YYYY-MM'
  comportamiento: string | null; // código crudo
  comportamientoLabel: string | null; // Tabla 9
}

// Tabla 10 — sectores de crédito (PN + PJ).
export interface MappedCreditSector {
  sector: string | null;
  sectorLabel: string | null; // Tabla 10
  creditosVigentes: string | null;
  creditosCerrados: string | null;
  saldoActual: string | null;
  saldoMora: string | null;
  porcentajeDeuda: string | null;
}

// Alerta de la central. Unificada PN+PJ: en PN es una alerta de texto sobre el
// propio titular (`informacionRiesgo.alertas`); en PJ es un nodo de la malla de
// vínculos con alertas (`cantidadAlertas > 0`), sea la propia empresa (`self`) o
// un vínculo (`linked`). Cada tipo llena su mitad; el otro va null.
export interface MappedRiskAlert {
  source: 'self' | 'linked';
  message: string | null; // PN: texto de la central. PJ: null (no hay texto).
  subject: string | null; // PJ: nombre de la entidad alertada. PN: null.
  identification: string | null; // PJ: documento de la entidad. PN: null.
  count: number | null; // PJ: nº de alertas del nodo. PN: null.
}

// Tabla 15 — nodo de la malla de vínculos (PJ), recursivo.
export interface MappedLinkNode {
  name: string | null;
  documentType: string | null; // tipoId
  documentNumber: string | null; // id
  alertCount: number | null;
  linkType: string | null; // type crudo (a veces null)
  linkTypeLabel: string | null; // Tabla 15
  children: MappedLinkNode[];
}

export interface MappedRiskSnapshot {
  score: number | null;
  viabilidad: string | null;
  viabilidadLabel: string | null; // Tabla 11
  ratingRecaudos: string | null;
  ratingRecaudosLabel: string | null; // Tabla 12
  nivelRiesgo: string | null;
  nivelRiesgoLabel: string | null; // Tabla 13
  ratingSectorial: string | null;
  ratingSectorialLabel: string | null; // Tabla 14
  montoSugerido: number | null;
  saldoActual: number | null;
  porcentajeDeuda: number | null;
  saldoMora: number | null;
  hasAlertas: boolean;
  // Detalle de las alertas de la central (el "cuáles" detrás de hasAlertas).
  // null si no hay. hasAlertas se deriva de aquí (length > 0) para que sean
  // siempre consistentes.
  alerts: MappedRiskAlert[] | null;
  // Endeudamiento reportado (solo PN): ingreso mensual y % ya comprometido en
  // cuotas. Referencia de capacidad de pago de la persona (la central no tiene
  // EEFF de PN). null en PJ.
  reportedIncome: number | null;
  quotaToIncomePct: number | null;
  // Bloques temporales (JSONB en customer_risk_snapshots). null si no aplica.
  creditPortfolio: MappedCreditPortfolioItem[] | null; // Tabla 8 (PJ)
  paymentBehavior: MappedPaymentBehaviorItem[] | null; // Tabla 9 (PN+PJ)
  creditSectors: MappedCreditSector[] | null; // Tabla 10 (PN+PJ)
  linkNetwork: MappedLinkNode | null; // Tabla 15 (PJ)
}

export interface ProviderConsultResult {
  meta: MappedConsultationMeta;
  customer: MappedCustomer | null; // null si no hubo información
  risk: MappedRiskSnapshot | null;
  httpStatus: number;
  raw: unknown; // respuesta cruda COMPLETA del proveedor, para archivar
}
