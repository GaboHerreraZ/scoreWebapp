import type {
  ExperianMiDecisorResponse,
  ExperianInfoTransaccion,
  ExperianValidacion,
  ExperianRespuesta,
  ExperianPersona,
  ExperianVinculoNodo,
} from './experian.types.js';
import type {
  PersonType,
  MappedConsultationMeta,
  MappedResponseCode,
  MappedCustomer,
  MappedRiskSnapshot,
  MappedBureauProfile,
  MappedBureauPerson,
  MappedCreditPortfolioItem,
  MappedPaymentBehaviorItem,
  MappedCreditSector,
  MappedLinkNode,
  MappedRiskAlert,
} from '../providers/provider-result.js';
import {
  translate,
  describeTxCode,
  LEGAL_ORGANIZATION,
  SEIZED,
  IN_LIQUIDATION,
  CREDIT_TYPE,
  PAYMENT_BEHAVIOR,
  SECTOR,
  VIABILITY,
  COLLECTION_RATING,
  RISK_LEVEL,
  SECTORAL_RISK,
  LINK_TYPE,
} from './experian.catalogs.js';

// ─── CAPA ANTICORRUPCIÓN (ACL) ──────────────────────────────────────────────
// Único punto acoplado a la forma de la respuesta de Experian. Traduce el JSON
// crudo a los DTOs de dominio propios (nombres neutros al proveedor). Si Experian
// cambia su forma, se toca SOLO este archivo. Promoción incremental: aquí se
// traduce lo que la app consume hoy (identidad, demografía PN, riesgo); el resto
// (perfil PJ, estados financieros, malla) queda dormido en rawResponse.

// Códigos de tipo de identificación de Experian (tabla 2 del manual MiDecisor)
// → code del Parameter 'identification_type' del sistema.
const EXPERIAN_DOC_TO_PARAM_CODE: Record<string, string> = {
  '1': 'cc',
  cc: 'cc',
  '2': 'nit',
  nit: 'nit',
  '4': 'ce',
  ce: 'ce',
  '5': 'pas',
  pas: 'pas',
  pa: 'pas',
};

// code del Parameter 'identification_type' → tipoIdentificacion que espera
// Experian en el body de la consulta.
const PARAM_CODE_TO_EXPERIAN_DOC: Record<string, string> = {
  cc: '1',
  nit: '2',
  ce: '4',
  pas: '5',
  pa: '5', // alias legacy por si aún llega el code antiguo
};

// Los tipos de dominio (MappedCustomer/MappedRiskSnapshot/MappedConsultationMeta/
// PersonType) viven en ../providers/provider-result.js (neutros al proveedor).
// El mapper solo los PRODUCE a partir de la respuesta cruda de Experian.
export interface MappedConsultation {
  meta: MappedConsultationMeta;
  customer: MappedCustomer | null; // null si no hubo información
  risk: MappedRiskSnapshot | null;
}

/** Convierte el code de Parameter (cc/nit/ce/pas) al tipoIdentificacion de Experian. */
export function toExperianDocType(paramCode: string): string | null {
  return PARAM_CODE_TO_EXPERIAN_DOC[paramCode.toLowerCase()] ?? null;
}

/**
 * Resuelve el code del Parameter 'identification_type' a partir del tipoDocumento
 * de Experian, que llega en formatos distintos según PN/PJ: código ('1','2'),
 * sigla ('CC','NIT') o etiqueta larga ('CÉDULA DE CIUDADANÍA' — típico en PN).
 */
function resolveDocParamCode(tipoDocumento?: string): string | null {
  const raw = (tipoDocumento ?? '').trim().toLowerCase();
  if (!raw || raw === '-') return null;
  const direct = EXPERIAN_DOC_TO_PARAM_CODE[raw];
  if (direct) return direct;
  // Etiqueta larga (p. ej. 'CÉDULA DE CIUDADANÍA'): se busca por prefijo cortado
  // ANTES de la vocal acentuada, para no depender de normalizar acentos.
  if (raw.includes('ciudadan')) return 'cc';
  if (raw.includes('extranjer')) return 'ce';
  if (raw.includes('pasaporte')) return 'pas';
  if (raw.includes('nit')) return 'nit';
  return null;
}

/**
 * Traduce la respuesta cruda de MiDecisor a los objetos de dominio. Determina si
 * hubo información válida (conInformacion). Si no la hay, customer/risk quedan
 * null y el llamador NO debe persistir (retorna "cliente no existe").
 */
export function mapMiDecisorResponse(raw: unknown): MappedConsultation {
  const res = (raw ?? {}) as ExperianMiDecisorResponse;
  const content = res.content ?? {};
  const info = content.infoTransaccion ?? {};
  const respuesta = content.respuesta ?? {};
  const validacion = respuesta.validacion ?? {};
  const datosBasicos = validacion.datosBasicos ?? {};

  const conInformacion = validacion.conInformacion === true;
  const personType: PersonType = resolvePersonType(datosBasicos.tipoDocumento);

  const meta: MappedConsultationMeta = {
    consultaAt: parseConsultaAt(info),
    tipoIdDigitado: info.tipoIdDigitado ?? null,
    numeroIdDigitado: info.numeroIdDigitado ?? null,
    txCode: extractTxCode(info),
    codigosRespuesta: info.codigosRespuesta ?? null,
    codigosRespuestaLabeled: mapResponseCodes(info),
    conInformacion,
    personType,
  };

  if (!conInformacion) {
    return { meta, customer: null, risk: null };
  }

  return {
    meta,
    customer: mapCustomer(
      personType,
      validacion,
      info.numeroIdDigitado ?? null,
    ),
    risk: mapRisk(personType, respuesta),
  };
}

function resolvePersonType(tipoDocumento?: string): PersonType {
  const code = (tipoDocumento ?? '').toLowerCase();
  // NIT / PJE → persona jurídica; el resto (CC, CE, PAS...) → natural.
  if (code === 'nit' || code === '2' || code === 'pje' || code === '3') {
    return 'PJ';
  }
  return 'PN';
}

function mapCustomer(
  personType: PersonType,
  validacion: ExperianValidacion,
  // Número tal como se DIGITÓ en la consulta (echo del bureau). Se usa como llave
  // del Customer para que coincida con lo que buscan el caché y el gate de
  // autorización; el bureau a veces devuelve el numeroDocumento con ceros a la
  // izquierda (p. ej. cédula '01092529335' vs '1092529335' digitada).
  numeroDigitado: string | null,
): MappedCustomer {
  const datosBasicos = validacion.datosBasicos ?? {};
  const demografica = validacion.informacionDemografica ?? {};

  // PJ: razón social. PN: DataCrédito manda el nombre en un solo campo
  // (nombreCompleto), no desglosado; se cae al desglose por si alguna variante
  // sí lo trae.
  const businessName =
    personType === 'PJ'
      ? (datosBasicos.razonSocial ?? '')
      : datosBasicos.nombreCompleto?.trim() ||
        joinName(
          datosBasicos.primerNombre,
          datosBasicos.segundoNombre,
          datosBasicos.primerApellido,
          datosBasicos.segundoApellido,
        );

  return {
    identificationTypeCode: resolveDocParamCode(datosBasicos.tipoDocumento),
    businessName,
    identificationNumber: numeroDigitado ?? datosBasicos.numeroDocumento ?? '',
    verificationDigit: datosBasicos.digitoVerificacion ?? null,
    firstName: personType === 'PN' ? (datosBasicos.primerNombre ?? null) : null,
    secondName:
      personType === 'PN' ? (datosBasicos.segundoNombre ?? null) : null,
    firstLastName:
      personType === 'PN' ? (datosBasicos.primerApellido ?? null) : null,
    secondLastName:
      personType === 'PN' ? (datosBasicos.segundoApellido ?? null) : null,
    // La demografía ligera puede venir en datosBasicos (variante PN observada) o
    // en un bloque informacionDemografica aparte: se leen ambos, datosBasicos
    // primero. fechaNacimiento/ciudad/género solo existen en el bloque aparte.
    birthDate:
      personType === 'PN' ? parseDate(demografica.fechaNacimiento) : null,
    birthCity:
      personType === 'PN' ? (demografica.ciudadNacimiento ?? null) : null,
    gender: personType === 'PN' ? (demografica.genero ?? null) : null,
    ageRange:
      personType === 'PN'
        ? (datosBasicos.rangoEdad ?? demografica.rangoEdad ?? null)
        : null,
    documentStatus:
      personType === 'PN'
        ? (datosBasicos.estadoDocumento ?? demografica.estadoDocumento ?? null)
        : null,
    bureauProfile: personType === 'PJ' ? mapBureauProfile(validacion) : null,
  };
}

// Traduce el bloque PJ de Experian al perfil de dominio (nombres propios). El
// Customer nunca guarda dialecto del proveedor: esta función es la frontera.
function mapBureauProfile(validacion: ExperianValidacion): MappedBureauProfile {
  const pg = validacion.perfilGeneral;
  const mat = validacion.matricula;
  const rl = validacion.representanteLegal;
  const jd = validacion.juntaDirectiva;
  const rf = validacion.revisoriaFiscal;
  const soc = validacion.socios;
  const con = validacion.datosContacto;

  return {
    generalProfile: pg
      ? {
          legalOrganization: pg.organizacionJuridica ?? null,
          legalOrganizationLabel: translate(
            LEGAL_ORGANIZATION,
            pg.organizacionJuridica,
          ),
          ciiuCode: pg.codigoCiiu ?? null,
          economicActivity: pg.actividadEconomica ?? null,
          employeeCount: pg.numeroEmpleados ?? null,
          employeeRange: pg.rangosEmpleados ?? null,
          seized: pg.embargos ?? null,
          seizedLabel: translate(SEIZED, pg.embargos),
          inLiquidation: pg.enLiquidacion ?? null,
          inLiquidationLabel: translate(IN_LIQUIDATION, pg.enLiquidacion),
          incorporationDate: pg.fechaConstitucion ?? null,
          authorizedCapital: pg.capitalAutorizado ?? null,
          subscribedCapital: pg.capitalSuscrito ?? null,
          paidCapital: pg.capitalPagado ?? null,
        }
      : null,
    registration: mat
      ? {
          number: mat.numero ?? null,
          chamberOfCommerce: mat.camaraComercio ?? null,
          incorporation: mat.constitucion ?? null,
          lastRenewal: mat.ultimaRenovacion ?? null,
          status: mat.estado ?? null,
        }
      : null,
    legalRep: rl
      ? {
          main: (rl.principales ?? []).map(mapPerson),
          alternates: (rl.suplentes ?? []).map(mapPerson),
        }
      : null,
    board: jd
      ? {
          main: (jd.principales ?? []).map(mapPerson),
          alternates: (jd.suplentes ?? []).map(mapPerson),
        }
      : null,
    statutoryAuditors: rf
      ? {
          main: (rf.principales ?? []).map(mapPerson),
          alternates: (rf.suplentes ?? []).map(mapPerson),
          auditFirm: rf.empresaAuditora ? mapPerson(rf.empresaAuditora) : null,
        }
      : null,
    partners: soc
      ? {
          list: (soc.sociosAccionistas ?? []).map(mapPerson),
          totalContributions: soc.totalAportes ?? null,
        }
      : null,
    contact: con
      ? {
          address: con.direccion ?? null,
          phone: con.telefono ?? null,
          city: con.ciudad ?? null,
          email: con.email ?? null,
        }
      : null,
  };
}

function mapPerson(p: ExperianPersona): MappedBureauPerson {
  return {
    documentType: p.tipoDocumento ?? null,
    documentNumber: p.numeroDocumento ?? null,
    name: p.nombre ?? null,
    lastName: p.apellidos ?? null,
    role: p.cargo ?? null,
    appointmentDate: p.fechaNombramiento ?? null,
    status: p.estado ?? null,
    participation: p.participacion ?? null,
  };
}

function mapRisk(
  personType: PersonType,
  respuesta: ExperianRespuesta,
): MappedRiskSnapshot {
  const riesgo = respuesta.informacionRiesgo ?? {};
  const comportamiento = respuesta.comportamientoCrediticio ?? {};
  const indicadores = comportamiento.indicadoresValores ?? {};
  const endeudamiento = respuesta.endeudamiento ?? {}; // ingreso reportado (PN)

  const viabilidad = personType === 'PN' ? (riesgo.viabilidad ?? null) : null;
  const ratingRecaudos =
    personType === 'PN' ? (riesgo.ratingRecaudos ?? null) : null;
  const nivelRiesgo = personType === 'PJ' ? (riesgo.nivel ?? null) : null;
  // Detalle de alertas: hasAlertas se deriva de aquí para que siempre concuerden.
  const alerts = resolveAlerts(personType, respuesta);
  // Tabla 14: el código tabulado es ratingRiesgoSectorial (0-5). Se conserva
  // descripcionRiesgoSectorial como fallback si la central ya manda el texto.
  const ratingSectorial =
    personType === 'PJ'
      ? (riesgo.ratingRiesgoSectorial ??
        riesgo.descripcionRiesgoSectorial ??
        null)
      : null;

  return {
    score:
      personType === 'PN'
        ? toNumber(riesgo.score)
        : toNumber(riesgo.puntajeScore),
    viabilidad,
    viabilidadLabel: translate(VIABILITY, viabilidad), // Tabla 11
    ratingRecaudos,
    ratingRecaudosLabel: translate(COLLECTION_RATING, ratingRecaudos), // Tabla 12
    nivelRiesgo,
    nivelRiesgoLabel: translate(RISK_LEVEL, nivelRiesgo), // Tabla 13
    ratingSectorial,
    ratingSectorialLabel: translate(SECTORAL_RISK, ratingSectorial), // Tabla 14
    montoSugerido: toNumber(riesgo.montoSugerido),
    saldoActual: toNumber(indicadores.saldoActual),
    porcentajeDeuda: toNumber(indicadores.porcentajeDeuda),
    saldoMora: toNumber(indicadores.saldoMora),
    hasAlertas: (alerts?.length ?? 0) > 0,
    alerts,
    // Endeudamiento reportado (PN): ingreso mensual + % ya comprometido.
    reportedIncome: toNumber(endeudamiento.ingreso),
    quotaToIncomePct: toNumber(endeudamiento.porcentajeCuotaVsIngreso),
    // Bloques temporales (cambian por consulta)
    creditPortfolio:
      personType === 'PJ' ? mapCreditPortfolio(comportamiento) : null, // Tabla 8
    paymentBehavior: mapPaymentBehavior(comportamiento), // Tabla 9 (PN+PJ)
    creditSectors: mapCreditSectors(indicadores), // Tabla 10 (PN+PJ)
    linkNetwork:
      personType === 'PJ'
        ? mapLinkNode(respuesta.mallaVinculos?.vinculados)
        : null, // Tabla 15
  };
}

// Tabla 8 — tipos de crédito por cartera (PJ).
function mapCreditPortfolio(
  comportamiento: NonNullable<ExperianRespuesta['comportamientoCrediticio']>,
): MappedCreditPortfolioItem[] | null {
  const items = comportamiento.saldoPorCarteraPJ?.tiposCredito;
  if (!Array.isArray(items) || items.length === 0) return null;
  return items.map((it) => ({
    tipoCredito: it.tipoCredito ?? null,
    tipoCreditoLabel: translate(CREDIT_TYPE, it.tipoCredito),
    saldo: it.saldo ?? null,
    porcentajePart: it.porcentajePart ?? null,
  }));
}

// Tabla 9 — comportamiento de pago mensual (PN + PJ).
function mapPaymentBehavior(
  comportamiento: NonNullable<ExperianRespuesta['comportamientoCrediticio']>,
): MappedPaymentBehaviorItem[] | null {
  const vector = comportamiento.comportamientoPago?.vectorComportamiento;
  if (!Array.isArray(vector) || vector.length === 0) return null;
  return vector.map((v) => ({
    anioMes: v.anioMes ?? null,
    comportamiento: v.comportamiento ?? null,
    comportamientoLabel: translate(PAYMENT_BEHAVIOR, v.comportamiento),
  }));
}

// Tabla 10 — sectores de crédito (PN + PJ).
function mapCreditSectors(
  indicadores: NonNullable<
    NonNullable<
      ExperianRespuesta['comportamientoCrediticio']
    >['indicadoresValores']
  >,
): MappedCreditSector[] | null {
  const sectores = indicadores.sectores;
  if (!Array.isArray(sectores) || sectores.length === 0) return null;
  return sectores.map((s) => ({
    sector: s.sector ?? null,
    sectorLabel: translate(SECTOR, s.sector),
    creditosVigentes: s.creditosVigentes ?? null,
    creditosCerrados: s.creditosCerrados ?? null,
    saldoActual: s.saldoActual ?? null,
    saldoMora: s.saldoMora ?? null,
    porcentajeDeuda: s.porcentajeDeuda ?? null,
  }));
}

// Tabla 15 — malla de vínculos (PJ), recursiva. El `type` puede venir null.
function mapLinkNode(
  node: ExperianVinculoNodo | undefined,
): MappedLinkNode | null {
  if (!node) return null;
  const linkType = node.type ?? node.tipoVinculo ?? null;
  return {
    name: node.nombre ?? null,
    documentType: node.tipoId ?? null,
    documentNumber: node.id ?? null,
    alertCount:
      typeof node.cantidadAlertas === 'number' ? node.cantidadAlertas : null,
    linkType,
    linkTypeLabel: translate(LINK_TYPE, linkType),
    children: Array.isArray(node.nodos)
      ? node.nodos
          .map((n) => mapLinkNode(n))
          .filter((n): n is MappedLinkNode => n !== null)
      : [],
  };
}

// Tabla 1 — códigos de respuesta con descripción (solo la clave TX está tabulada).
function mapResponseCodes(info: ExperianInfoTransaccion): MappedResponseCode[] {
  const codes = info.codigosRespuesta;
  if (!Array.isArray(codes)) return [];
  return codes.map((c) => ({
    clave: c.clave ?? null,
    valor: c.valor ?? null,
    descripcion: c.clave === 'TX' ? describeTxCode(c.valor) : null,
  }));
}

// Detalle de las alertas de la central (el "cuáles" detrás de hasAlertas).
//  - PN: cada entrada de `informacionRiesgo.alertas` es un texto sobre el titular.
//  - PJ: no hay lista de texto; las alertas son los nodos de la malla de vínculos
//    con `cantidadAlertas > 0` (la raíz = la propia empresa → 'self'; el resto,
//    vínculos → 'linked'). Se recorre el árbol completo.
function resolveAlerts(
  personType: PersonType,
  respuesta: ExperianRespuesta,
): MappedRiskAlert[] | null {
  if (personType === 'PN') {
    const alertas = respuesta.informacionRiesgo?.alertas;
    if (!Array.isArray(alertas)) return null;
    const mapped = alertas
      .map((a) => (a?.alerta ?? '').trim())
      .filter((text) => text.length > 0)
      .map(
        (text): MappedRiskAlert => ({
          source: 'self',
          message: text,
          subject: null,
          identification: null,
          count: null,
        }),
      );
    return mapped.length > 0 ? mapped : null;
  }
  // PJ: recolectar los nodos alertados de la malla de vínculos.
  const root = respuesta.mallaVinculos?.vinculados;
  if (!root) return null;
  const acc: MappedRiskAlert[] = [];
  collectAlertedNodes(root, true, acc);
  return acc.length > 0 ? acc : null;
}

function collectAlertedNodes(
  node: ExperianVinculoNodo,
  isRoot: boolean,
  acc: MappedRiskAlert[],
): void {
  const count =
    typeof node.cantidadAlertas === 'number' ? node.cantidadAlertas : 0;
  if (count > 0) {
    acc.push({
      source: isRoot ? 'self' : 'linked',
      message: null,
      subject: node.nombre ?? null,
      identification: node.id ?? null,
      count,
    });
  }
  if (Array.isArray(node.nodos)) {
    for (const child of node.nodos) collectAlertedNodes(child, false, acc);
  }
}

// ── Helpers de parsing ──────────────────────────────────────────────────────

function extractTxCode(info: ExperianInfoTransaccion): string | null {
  const tx = info.codigosRespuesta?.find((c) => c.clave === 'TX');
  return tx?.valor ?? null;
}

function parseConsultaAt(info: ExperianInfoTransaccion): Date {
  // La central entrega día/mes/año/hora por separado. Si falta algo, cae a "ahora"
  // NO se puede usar new Date() sin args en scripts de workflow, pero aquí (NestJS
  // runtime) sí es válido.
  const dia = Number(info.diaConsulta);
  const mes = Number(info.mesConsulta);
  const anio = Number(info.anioConsulta);
  const [h, m, s] = (info.horaConsulta ?? '')
    .split(':')
    .map((n) => Number(n) || 0);

  if (dia && mes && anio) {
    return new Date(anio, mes - 1, dia, h, m, s);
  }
  return new Date();
}

function parseDate(value?: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toNumber(value?: string | number | null): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isNaN(n) ? null : n;
}

function joinName(...parts: Array<string | undefined>): string {
  return parts.filter((p) => p && p.trim()).join(' ');
}
