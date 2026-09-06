import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import Handlebars from 'handlebars';

// Compilada una sola vez; el .html se copia junto al build (nest-cli assets).
let compiled: Handlebars.TemplateDelegate | null = null;

function getTemplate(): Handlebars.TemplateDelegate {
  if (compiled) return compiled;
  const here = dirname(fileURLToPath(import.meta.url));
  const templatePath = join(
    here,
    'templates',
    'bureau-check-report.template.html',
  );
  const source = readFileSync(templatePath, 'utf-8');
  compiled = Handlebars.compile(source);
  return compiled;
}

export function renderBureauCheckHtml(data: unknown): string {
  return getTemplate()(data);
}
