import type {
  ExperianMiDecisorResponse,
  ExperianEstadosFinancieros,
  ExperianEstadoFinancieroGrupo,
} from './experian.types.js';
import { thousandsToPesos } from './experian.mapper.js';

// ─── MAPPER DE ESTADOS FINANCIEROS (PJ) ─────────────────────────────────────
// Traduce el bloque `estadosFinancieros` de MiDecisor (matriz cuenta × año, en
// español, con nombres de Experian) a las cifras crudas por año que usa el
// dominio (columnas de FinancialStatementPeriod). Es la frontera ACL para EEFF:
// rawResponse sigue puro; aquí se produce el modelo neutro. Las cifras de la
// central vienen en MILES de pesos: se normalizan a pesos completos AQUÍ
// (thousandsToPesos), igual que los saldos del snapshot de riesgo.
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

/** Una columna del bloque de EEFF: un par (año, fuente) con sus cifras. */
interface FinancialColumn {
  index: number; // posición en anio[]/fuente[]/valores[]
  fiscalYear: number;
  source: string; // fuente normalizada ('' si la central no la reporta)
  figures: Record<string, number | null>;
}

/**
 * Extrae los estados financieros de una respuesta MiDecisor cruda como cifras
 * por año, ordenadas por fiscalYear DESC. Devuelve [] cuando no se pueden usar.
 *
 * Regla de negocio (EEFF duales, mismos períodos que el PDF a contrastar):
 * cada columna es un par (año, fuente). Se toman las `limitYears` columnas con
 * cifras reales MÁS RECIENTES y se exige que TODAS sean de la MISMA fuente.
 * Fuentes distintas no son comparables (distinto reportante/estándar) y sus
 * períodos no cuadrarían con los del PDF, así que en ese caso se devuelve []
 * y el estudio se apoya en los EEFF del PDF. También [] si hay menos de
 * `limitYears` columnas reales, o si no hay bloque/no tiene información.
 *
 * Ej.: 2023·Supersociedades / 2024·Supersociedades / 2025·Cámaras → las 2 más
 * recientes (2024·Super, 2025·Cámaras) son de fuentes distintas → [] (PDF).
 * Las columnas vacías (todo "-"/0) se descartan ANTES de mirar recencia, así un
 * año nuevo sin cifras no bloquea el par real anterior.
 */
export function mapDataCreditoFinancials(
  raw: unknown,
  limitYears = 2,
): MappedFinancialPeriod[] {
  const res = (raw ?? {}) as ExperianMiDecisorResponse;
  const eeff = res.content?.respuesta?.estadosFinancieros;
  if (!eeff || eeff.conInformacion === false) return [];

  const columns = pivotByColumn(eeff);

  // Solo columnas con cifras reales (una estructura toda "-"/0 no es info).
  const withFigures = columns.filter((c) => hasRealFigures(c.figures));
  withFigures.sort((a, b) => b.fiscalYear - a.fiscalYear);

  // Se necesitan al menos `limitYears` períodos reales.
  if (withFigures.length < limitYears) return [];

  // Las N más recientes deben ser de la MISMA fuente; si no, no se usan.
  const recent = withFigures.slice(0, limitYears);
  const source = recent[0].source;
  if (!recent.every((c) => c.source === source)) return [];

  return recent.map((c) => ({ fiscalYear: c.fiscalYear, figures: c.figures }));
}

/**
 * ¿Este conjunto de cifras trae al menos una distinta de 0/null? Todas en 0 (o
 * nulas) es una estructura vacía, no información real.
 */
function hasRealFigures(figures: Record<string, number | null>): boolean {
  return Object.values(figures).some((v) => typeof v === 'number' && v !== 0);
}

/**
 * Convierte un valor crudo de `valores` a número de dominio. MiDecisor entrega
 * los importes como STRING numérico ("1325.0") y usa "-"/"" para "sin dato".
 * Acepta también number por robustez. Devuelve null si no es un número válido.
 */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const s = value.trim();
    if (s === '' || s === '-') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Pivota la matriz cuenta × columna a una lista de columnas (año, fuente,
 * cifras). Recorre los grupos de cifras acumulando por ÍNDICE de columna (no por
 * año), luego adjunta a cada columna su año (anio[i]) y su fuente (fuente[i],
 * del elemento `nombre:"fuentes"`). Indexar por posición evita que dos fuentes
 * con el mismo año colisionen.
 */
function pivotByColumn(eeff: ExperianEstadosFinancieros): FinancialColumn[] {
  const groups = extractGroups(eeff.detalle);

  // Fuente por columna (elemento aparte `nombre:"fuentes"`, sin anio/datos).
  const fuentesEl = groups.find((g) => normalize(g.nombre) === 'fuentes');
  const sources = asArray<unknown>(fuentesEl?.fuente).map((s) =>
    normalize(typeof s === 'string' ? s : ''),
  );

  // Años canónicos: los comparten todos los grupos de cifras; tomo el primero.
  const figureGroups = groups.filter((g) =>
    FIGURE_CATEGORIES.has(normalize(g.nombre)),
  );
  const years = asArray<number>(figureGroups[0]?.anio);

  // Acumular cifras por índice de columna.
  const byColumn = new Map<number, Record<string, number | null>>();
  for (const grupo of figureGroups) {
    for (const cuenta of asArray<{ nombre?: string; valores?: unknown }>(
      grupo.datos,
    )) {
      const column = ACCOUNT_MAP[normalize(cuenta.nombre)];
      if (!column) continue; // cuenta sin equivalente en el modelo → se ignora
      const valores = asArray<unknown>(cuenta.valores);
      valores.forEach((value, i) => {
        const bucket = byColumn.get(i) ?? {};
        // Todas las cuentas de ACCOUNT_MAP son monetarias y la central las
        // entrega en MILES; la categoría "Indicadores" (ratios, sin escalar)
        // ya quedó excluida por FIGURE_CATEGORIES.
        bucket[column] = thousandsToPesos(toNumber(value));
        byColumn.set(i, bucket);
      });
    }
  }

  const columns: FinancialColumn[] = [];
  for (const [index, figures] of byColumn) {
    const fiscalYear = years[index];
    if (typeof fiscalYear !== 'number') continue;
    columns.push({ index, fiscalYear, source: sources[index] ?? '', figures });
  }
  return columns;
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
