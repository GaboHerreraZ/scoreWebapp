// Tipos PARCIALES de la respuesta cruda de MiDecisor: solo los caminos que el
// mapper lee para promover a dominio en la Fase 3 (identidad, demografía, riesgo,
// metadata de transacción). El resto de la respuesta NO se tipa aquí: queda
// crudo en rawResponse, listo para promoverse después. Todo es opcional porque
// la forma puede variar según PN/PJ y según lo que la central tenga.

export interface ExperianCodigoRespuesta {
  clave?: string; // 'CC', 'HC', 'DE', 'SS', 'TX'...
  valor?: string; // '00', '02', '17'...
}

export interface ExperianInfoTransaccion {
  diaConsulta?: string;
  mesConsulta?: string;
  anioConsulta?: string;
  horaConsulta?: string;
  tipoIdDigitado?: string;
  numeroIdDigitado?: string;
  apellidoDigitado?: string;
  codigosRespuesta?: ExperianCodigoRespuesta[];
}

export interface ExperianDatosBasicos {
  conInformacion?: boolean;
  // PJ
  razonSocial?: string;
  digitoVerificacion?: string;
  // PN — DataCrédito manda el nombre completo en un solo campo (nombreCompleto),
  // NO desglosado; y la demografía ligera (rangoEdad, estadoDocumento,
  // nacionalidad) viene aquí dentro, no en informacionDemografica.
  nombreCompleto?: string;
  primerNombre?: string;
  segundoNombre?: string;
  primerApellido?: string;
  segundoApellido?: string;
  rangoEdad?: string;
  estadoDocumento?: string;
  nacionalidad?: string;
  // ambos. tipoDocumento llega como código ('1','2'), sigla ('CC','NIT') o
  // etiqueta larga ('CÉDULA DE CIUDADANÍA') según PN/PJ.
  tipoDocumento?: string;
  numeroDocumento?: string;
}

export interface ExperianInformacionDemografica {
  conInformacion?: boolean;
  fechaNacimiento?: string; // 'YYYY-MM-DD'
  ciudadNacimiento?: string;
  genero?: string;
  rangoEdad?: string;
  estadoDocumento?: string;
}

// ── Bloques PJ (perfil general, matrícula, personas, socios, contacto) ──────
export interface ExperianPerfilGeneral {
  organizacionJuridica?: string;
  codigoCiiu?: string;
  actividadEconomica?: string;
  numeroEmpleados?: string;
  rangosEmpleados?: string;
  embargos?: string;
  enLiquidacion?: string;
  fechaConstitucion?: string;
  capitalAutorizado?: string;
  capitalSuscrito?: string;
  capitalPagado?: string;
}

export interface ExperianMatricula {
  numero?: string;
  camaraComercio?: string;
  constitucion?: string;
  ultimaRenovacion?: string;
  estado?: string;
}

export interface ExperianPersona {
  tipoDocumento?: string;
  numeroDocumento?: string;
  nombre?: string;
  apellidos?: string;
  cargo?: string;
  fechaNombramiento?: string;
  estado?: string;
  participacion?: string;
}

export interface ExperianPrincipalesSuplentes {
  principales?: ExperianPersona[];
  suplentes?: ExperianPersona[];
}

export interface ExperianRevisoriaFiscal extends ExperianPrincipalesSuplentes {
  empresaAuditora?: ExperianPersona;
}

export interface ExperianSocios {
  sociosAccionistas?: ExperianPersona[];
  totalAportes?: string;
}

export interface ExperianDatosContacto {
  direccion?: string;
  telefono?: string;
  ciudad?: string;
  email?: string;
}

export interface ExperianValidacion {
  conInformacion?: boolean;
  datosBasicos?: ExperianDatosBasicos;
  informacionDemografica?: ExperianInformacionDemografica; // solo PN
  // PJ
  perfilGeneral?: ExperianPerfilGeneral;
  matricula?: ExperianMatricula;
  representanteLegal?: ExperianPrincipalesSuplentes;
  juntaDirectiva?: ExperianPrincipalesSuplentes;
  revisoriaFiscal?: ExperianRevisoriaFiscal;
  socios?: ExperianSocios;
  datosContacto?: ExperianDatosContacto;
}

// Tabla 10 - sector por cartera (PN + PJ)
export interface ExperianSector {
  sector?: string;
  creditosVigentes?: string;
  creditosCerrados?: string;
  totalPrincipal?: string;
  totalCodeudorOtros?: string;
  valorInicial?: string;
  saldoActual?: string;
  valorCuota?: string;
  saldoMora?: string;
  porcentajeDeuda?: string;
}

export interface ExperianIndicadoresValores {
  saldoActual?: string;
  saldoMora?: string;
  porcentajeDeuda?: string;
  sectores?: ExperianSector[]; // Tabla 10
}

// Tabla 9 - vector de comportamiento de pago (PN + PJ), ~12 meses
export interface ExperianVectorComportamiento {
  anioMes?: string; // 'YYYY-MM'
  comportamiento?: string; // 'N' | '1'..'6' | 'C' | 'D' | '-' | ' '
}

export interface ExperianComportamientoPago {
  vectorComportamiento?: ExperianVectorComportamiento[];
}

// Tabla 8 - tipos de crédito por cartera (solo PJ)
export interface ExperianTipoCredito {
  tipoCredito?: string; // 'Comercial' | 'Consumo' | 'Microcredito' | 'Hipotecario'
  saldo?: string;
  porcentajePart?: string;
}

export interface ExperianSaldoPorCarteraPJ {
  trimestre?: string;
  saldoTotal?: string;
  tiposCredito?: ExperianTipoCredito[];
}

export interface ExperianComportamientoCrediticio {
  indicadoresValores?: ExperianIndicadoresValores;
  comportamientoPago?: ExperianComportamientoPago; // Tabla 9
  saldoPorCarteraPJ?: ExperianSaldoPorCarteraPJ; // Tabla 8 (PJ)
}

export interface ExperianAlerta {
  alerta?: string;
}

export interface ExperianInformacionRiesgo {
  // PN
  score?: string;
  viabilidad?: string;
  ratingRecaudos?: string;
  alertas?: ExperianAlerta[];
  // PJ
  puntajeScore?: string;
  nivel?: string;
  descripcionRiesgoSectorial?: string;
  ratingRiesgoSectorial?: string;
  // ambos
  montoSugerido?: string;
}

// Tabla 15 - malla de vínculos (solo PJ). El árbol real usa nombre/tipoId/id/
// cantidadAlertas/nodos (recursivo). `type`/`tipoVinculo` puede venir null.
export interface ExperianVinculoNodo {
  nombre?: string;
  tipoId?: string;
  id?: string;
  cantidadAlertas?: number;
  type?: string; // 'alertado' | 'ejecutivo' | 'empresa' (a veces null)
  tipoVinculo?: string;
  nodos?: ExperianVinculoNodo[];
}

export interface ExperianMallaVinculos {
  resumenData?: Array<{ nombre?: string; total?: number; alertados?: number }>;
  vinculados?: ExperianVinculoNodo;
}

// Estados financieros (PJ): matriz cuenta × columna. `detalle.data` agrupa por
// categoría (Activos, Pasivos, Patrimonio, Estado de Resultados, Indicadores);
// cada grupo trae los años (`anio`) y las cuentas (`datos`), donde `valores` está
// alineado posicionalmente con `anio`. Un elemento aparte (`nombre:"fuentes"`)
// trae `fuente[]`, la FUENTE de cada columna, también alineada con `anio` (p. ej.
// "Supersociedades" / "Cámaras de comercio"). Los valores llegan como string
// numérico ("1325.0") o "-" cuando no hay dato — nunca number puro.
export interface ExperianEstadoFinancieroCuenta {
  nombre?: string;
  valores?: Array<number | string | null>;
}

export interface ExperianEstadoFinancieroGrupo {
  nombre?: string;
  anio?: number[];
  datos?: ExperianEstadoFinancieroCuenta[];
  fuente?: string[]; // solo en el elemento nombre:"fuentes"; fuente por columna
}

export interface ExperianEstadosFinancieros {
  conInformacion?: boolean;
  msjExcepcion?: string | null;
  detalle?: ExperianEstadoFinancieroGrupo[];
}

// Endeudamiento (solo PN): ingreso mensual reportado y % del ingreso ya
// comprometido en cuotas. Es el único dato financiero que la central tiene de una
// persona (la PJ reporta EEFF; la PN no) → sirve de referencia de capacidad.
export interface ExperianEndeudamiento {
  conInformacion?: boolean;
  ingreso?: string; // ingreso mensual reportado ('1313000.0')
  porcentajeCuotaVsIngreso?: string; // % del ingreso ya comprometido ('3.8')
}

export interface ExperianRespuesta {
  validacion?: ExperianValidacion;
  comportamientoCrediticio?: ExperianComportamientoCrediticio;
  informacionRiesgo?: ExperianInformacionRiesgo;
  endeudamiento?: ExperianEndeudamiento; // ingreso reportado (PN)
  estadosFinancieros?: ExperianEstadosFinancieros; // EEFF (PJ)
  mallaVinculos?: ExperianMallaVinculos; // Tabla 15 (PJ)
}

export interface ExperianContent {
  infoTransaccion?: ExperianInfoTransaccion;
  respuesta?: ExperianRespuesta;
}

export interface ExperianMiDecisorResponse {
  status?: string;
  content?: ExperianContent;
}
