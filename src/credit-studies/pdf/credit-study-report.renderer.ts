import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import Handlebars from 'handlebars';

/**
 * Carga y compila la plantilla del PDF UNA sola vez (cacheada a nivel de módulo).
 * El .html se copia adyacente al build vía nest-cli assets (ver nest-cli.json:
 * outDir dist/src), así que resuelve junto a este archivo compilado.
 */
let compiled: Handlebars.TemplateDelegate | null = null;

function getTemplate(): Handlebars.TemplateDelegate {
  if (compiled) return compiled;
  const here = dirname(fileURLToPath(import.meta.url));
  const templatePath = join(
    here,
    'templates',
    'credit-study-report.template.html',
  );
  const source = readFileSync(templatePath, 'utf-8');
  compiled = Handlebars.compile(source);
  return compiled;
}

/** Renderiza el HTML final del reporte a partir del view-model ya mapeado. */
export function renderReportHtml(data: unknown): string {
  return getTemplate()(data);
}
