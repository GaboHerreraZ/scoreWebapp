import type {
  ExperianMiDecisorResponse,
  ExperianEstadosFinancieros,
  ExperianEstadoFinancieroGrupo,
} from './experian.types.js';

// ─── MAPPER DE ESTADOS FINANCIEROS (PJ) ─────────────────────────────────────
// Traduce el bloque `estadosFinancieros` de MiDecisor (matriz cuenta × año, en
// español, con nombres de Experian) a las cifras crudas por año que usa el
// dominio (columnas de FinancialStatementPeriod). Es la frontera ACL para EEFF:
// rawResponse sigue puro; aquí se produce el modelo neutro.
//
// Forma cruda: detalle[] agrupa por categoría (Activos, Pasivos, Patrimonio,
// Estado de Resultados, Indicadores). Cada grupo trae `anio: number[]` y
// `datos: [{ nombre, valores: number[] }]`, con `valores` alineado
// posicionalmente con `anio`. Se PIVOTA a un objeto de cifras por año.

/** Cifras crudas de UN año, en las claves del dominio (subset de las columnas). */
export interface MappedFinancialPeriod {
  fiscalYear: number;
  figures: Record<string, number | null>;
}

// Nombre de cuenta de Experian (normalizado) → columna de FinancialStatementPeriod.
// Solo las cuentas que tienen equivalente directo en el modelo. Las que Experian
// no desglosa (depreciación/amortización dentro de gastos) quedan sin mapear.
const ACCOUNT_MAP: Record<string, string> = {
  // ── Activos ──
  efectivo: 'cashAndEquivalents',
  'cuentas comerciales por cobrar': 'accountsReceivable',
  inventarios: 'inventories',
  'total activo corriente': 'totalCurrentAssets',
  'propiedad planta y equipo': 'fixedAssetsProperty',
  'total activo no corriente': 'totalNonCurrentAssets',
  'total activo': 'totalAssets',
  // ── Pasivos ──
  'obligaciones financieras corto plazo': 'shortTermFinancialLiabilities',
  'cuentas comerciales por pagar': 'suppliers',
  'total pasivo corriente': 'totalCurrentLiabilities',
  'obligaciones financieras largo plazo': 'longTermFinancialLiabilities',
  'total pasivo no corriente': 'totalNonCurrentLiabilities',
  'total pasivo': 'totalLiabilities',
  // ── Patrimonio ──
  'utilidad retenida': 'retainedEarnings',
  'total patrimonio': 'equity',
  // ── Estado de Resultados ──
  'ingresos operacionales': 'ordinaryActivityRevenue',
  'costo ventas': 'costOfSales',
  'utilidad bruta': 'grossProfit',
  'gastos de administracion': 'administrativeExpenses',
  'gastos ventas': 'sellingExpenses',
  'gasto o ingreso por impuestos': 'taxes',
  'utilidad neta': 'netIncome',
};

// Categorías de `detalle` cuyas cuentas aportan cifras crudas. La categoría
// "Indicadores" se ignora: esos ratios los recalculamos nosotros (comparabilidad
// con el PDF), no se toman de Experian.
const FIGURE_CATEGORIES = new Set([
  'activos',
  'pasivos',
  'patrimonio',
  'estado de resultados',
]);

/** Normaliza un nombre para el lookup: minúsculas, sin tildes ni espacios extra. */
function normalize(name: string | undefined): string {
  return (name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita diacriticos
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normaliza un valor a array. MiDecisor (serializador SOAP→JSON) es inconsistente:
 * una colección con un solo elemento a veces llega como objeto suelto, y una
 * colección vacía como `{}` o `null` en vez de `[]`. Sin esto, un `for...of`
 * sobre un objeto lanza "object is not iterable". Array → tal cual; null/undefined
 * → []; objeto → [objeto]; primitivo → [].
 */
function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value === null || value === undefined) return [];
  if (typeof value === 'object') {
    // Objeto vacío ({}) = colección vacía; objeto con datos = un solo elemento.
    return Object.keys(value).length === 0 ? [] : [value as T];
  }
  return [];
}

/**
 * Extrae los estados financieros de una respuesta MiDecisor cruda y los devuelve
 * como cifras por año, ordenadas por fiscalYear DESC. Devuelve [] si no hay
 * bloque de EEFF o no tiene información. `limitYears` recorta a los N años más
 * recientes (2 por decisión de negocio).
 */
export function mapDataCreditoFinancials(
  raw: unknown,
  limitYears = 2,
): MappedFinancialPeriod[] {
  const res = (raw ?? {}) as ExperianMiDecisorResponse;
  const eeff = res.content?.respuesta?.estadosFinancieros;
  if (!eeff || eeff.conInformacion === false) return [];

  const periods = pivotByYear(eeff);

  // Descartar períodos SIN cifras reales. La central a veces devuelve la
  // ESTRUCTURA de EEFF con todos los valores en 0 (p. ej. empresa con matrícula
  // cancelada que no reportó): la estructura vacía NO es información financiera.
  // Un período todo-ceros no permite contrastar veracidad ni calcular
  // indicadores → se trata como si no hubiera EEFF de esa fuente.
  const withFigures = periods.filter(hasRealFigures);

  withFigures.sort((a, b) => b.fiscalYear - a.fiscalYear);
  return withFigures.slice(0, limitYears);
}

/**
 * ¿El período trae al menos una cifra distinta de 0/null? Un período con todas
 * las cifras en 0 (o nulas) es una estructura vacía, no información real.
 */
function hasRealFigures(period: MappedFinancialPeriod): boolean {
  return Object.values(period.figures).some(
    (v) => typeof v === 'number' && v !== 0,
  );
}

/**
 * Pivota la matriz cuenta × año a un objeto de cifras por año. Recorre cada
 * grupo de cifras; para cada cuenta mapeada, coloca su valor en el año que le
 * corresponde por posición (valores[i] ↔ anio[i]).
 */
function pivotByYear(
  eeff: ExperianEstadosFinancieros,
): MappedFinancialPeriod[] {
  const byYear = new Map<number, Record<string, number | null>>();

  for (const grupo of extractGroups(eeff.detalle)) {
    if (!FIGURE_CATEGORIES.has(normalize(grupo.nombre))) continue;
    accumulateGroup(grupo, byYear);
  }

  return Array.from(byYear.entries()).map(([fiscalYear, figures]) => ({
    fiscalYear,
    figures,
  }));
}

/**
 * Obtiene los grupos de cifras (Activos, Pasivos, ...) de `detalle`. MiDecisor
 * devuelve DOS formas para el mismo bloque:
 *  - `detalle: [ {nombre, anio, datos}, ... ]`  (array directo de grupos), o
 *  - `detalle: { data: [ {nombre, anio, datos}, ... ], msjExcepcion, ... }`
 *    (objeto envolvente con los grupos en `.data`).
 * Se normalizan ambas a una lista plana de grupos. El primer elemento de `.data`
 * suele ser `{nombre:'fuentes', fuente:[...]}` (sin anio/datos): no matchea las
 * categorías de cifras y se descarta aguas arriba.
 */
function extractGroups(detalle: unknown): ExperianEstadoFinancieroGrupo[] {
  // Forma envolvente: { data: [...] }.
  if (
    detalle !== null &&
    typeof detalle === 'object' &&
    !Array.isArray(detalle) &&
    'data' in detalle
  ) {
    return asArray<ExperianEstadoFinancieroGrupo>(
      (detalle as { data?: unknown }).data,
    );
  }
  // Forma directa (array) o cualquier otra: se normaliza a array.
  return asArray<ExperianEstadoFinancieroGrupo>(detalle);
}

function accumulateGroup(
  grupo: ExperianEstadoFinancieroGrupo,
  byYear: Map<number, Record<string, number | null>>,
): void {
  const years = asArray<number>(grupo.anio);
  for (const cuenta of asArray<{ nombre?: string; valores?: unknown }>(
    grupo.datos,
  )) {
    const column = ACCOUNT_MAP[normalize(cuenta.nombre)];
    if (!column) continue; // cuenta sin equivalente en el modelo → se ignora
    const valores = asArray<number>(cuenta.valores);
    years.forEach((year, i) => {
      if (typeof year !== 'number') return;
      const bucket = byYear.get(year) ?? {};
      const value = valores[i];
      bucket[column] = typeof value === 'number' ? value : null;
      byYear.set(year, bucket);
    });
  }
}
