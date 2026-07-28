import { Injectable, InternalServerErrorException, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Márgenes de página. Acepta unidades: in, cm, mm, pt, px (o número = pulgadas). */
export interface PdfMargin {
  top?: string | number;
  bottom?: string | number;
  left?: string | number;
  right?: string | number;
}

export interface PdfOptions {
  /** Tamaño de página. Por defecto A4. */
  format?: 'A4' | 'Letter';
  landscape?: boolean;
  /** Imprime fondos de color/imágenes. Por defecto true (las plantillas los usan). */
  printBackground?: boolean;
  scale?: number;
  margin?: PdfMargin;
  /**
   * Encabezado y pie. Se renderizan en un contexto Chromium APARTE: el CSS del
   * documento principal NO aplica y no se cargan recursos externos, así que
   * todo el estilo debe ir inline. Soportan `<span class="pageNumber">` y
   * `<span class="totalPages">`.
   */
  headerHtml?: string;
  footerHtml?: string;
  /** Espera adicional antes de imprimir (p. ej. '1s'). Normalmente innecesario. */
  waitDelay?: string;
  /** Timeout de la petición a Gotenberg. Por defecto 60s. */
  timeoutMs?: number;
}

/** Pulgadas por unidad, para normalizar los márgenes (Gotenberg los quiere en pulgadas). */
const INCHES_PER_UNIT: Record<string, number> = {
  in: 1,
  cm: 1 / 2.54,
  mm: 1 / 25.4,
  pt: 1 / 72,
  px: 1 / 96,
};

/** Dimensiones de página en pulgadas. */
const PAPER_SIZES = {
  A4: { width: 8.27, height: 11.7 },
  Letter: { width: 8.5, height: 11 },
} as const;

/**
 * Servicio genérico HTML → PDF. El render lo hace **Gotenberg**, un servicio
 * aparte que expone Chromium por HTTP; esta API ya no embebe el navegador.
 *
 * El motivo es de capacidad: cada render abre un Chromium que consume cientos
 * de MB. Teniéndolo dentro del proceso, un pico de PDFs simultáneos competía
 * por la memoria con el resto de la API (logins, webhooks, consultas). Ahora el
 * pico lo absorbe un contenedor dedicado y un fallo de render no tumba la API.
 *
 * El HTML debe seguir siendo autocontenido (CSS inline, sin recursos externos):
 * Gotenberg lo recibe como un archivo suelto, no navega a ninguna URL.
 *
 * DESPLIEGUE (Railway): el servicio va sin dominio público y se alcanza por la
 * red privada — GOTENBERG_URL=http://<servicio>.railway.internal:3000 (3000 es
 * el puerto del contenedor; el 3001 del compose es solo el mapeo local).
 * NO configurar API_BIND_IP: la red privada alcanza el 0.0.0.0 por defecto, y
 * los valores IPv6 no sirven en Gotenberg 8.34 — `::` pasa la validación pero
 * rompe el listen ("too many colons"), y `[::]` la falla ("must be a valid IP").
 */
@Injectable()
export class PdfService implements OnModuleInit {
  private readonly logger = new Logger(PdfService.name);
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    // Sin barra final: se concatena con rutas que ya empiezan con '/'.
    this.baseUrl = (
      this.configService.get<string>('GOTENBERG_URL') ?? ''
    ).replace(/\/+$/, '');
  }

  /**
   * Ping best-effort al arranque: avisa temprano si el servicio no responde,
   * pero NO bloquea el boot (el resto de la API funciona sin PDFs).
   */
  async onModuleInit(): Promise<void> {
    if (!this.baseUrl) {
      this.logger.warn(
        'GOTENBERG_URL no está configurada: la generación de PDFs fallará.',
      );
      return;
    }
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        this.logger.log(`Gotenberg disponible en ${this.baseUrl}`);
      } else {
        this.logger.warn(`Gotenberg respondió ${res.status} en /health.`);
      }
    } catch (err) {
      this.logger.warn(
        `No se pudo contactar a Gotenberg en ${this.baseUrl}; se reintentará en el primer PDF. ${
          (err as Error).message
        }`,
      );
    }
  }

  /** Renderiza un HTML autocontenido a un Buffer PDF. */
  async htmlToPdf(html: string, options: PdfOptions = {}): Promise<Buffer> {
    if (!this.baseUrl) {
      throw new InternalServerErrorException(
        'Generación de PDF no disponible: falta configurar GOTENBERG_URL.',
      );
    }

    const paper = PAPER_SIZES[options.format ?? 'A4'];
    const margin = options.margin ?? {};

    const form = new FormData();
    // El archivo principal DEBE llamarse index.html; es como Gotenberg lo identifica.
    form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');

    if (options.headerHtml) {
      form.append(
        'files',
        new Blob([this.asDocument(options.headerHtml)], { type: 'text/html' }),
        'header.html',
      );
    }
    if (options.footerHtml) {
      form.append(
        'files',
        new Blob([this.asDocument(options.footerHtml)], { type: 'text/html' }),
        'footer.html',
      );
    }

    form.append('paperWidth', String(paper.width));
    form.append('paperHeight', String(paper.height));
    form.append('marginTop', this.toInches(margin.top, 0.39));
    form.append('marginBottom', this.toInches(margin.bottom, 0.39));
    form.append('marginLeft', this.toInches(margin.left, 0.39));
    form.append('marginRight', this.toInches(margin.right, 0.39));
    // Gotenberg trae printBackground en false; las plantillas dependen de los
    // fondos de color, así que aquí el default es true (como estaba con Puppeteer).
    form.append('printBackground', String(options.printBackground ?? true));
    form.append('landscape', String(options.landscape ?? false));
    if (options.scale !== undefined) form.append('scale', String(options.scale));
    if (options.waitDelay) form.append('waitDelay', options.waitDelay);

    const timeoutMs = options.timeoutMs ?? 60_000;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/forms/chromium/convert/html`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const message =
        (err as Error).name === 'TimeoutError'
          ? `Gotenberg no respondió en ${timeoutMs} ms.`
          : `No se pudo contactar a Gotenberg: ${(err as Error).message}`;
      this.logger.error(message);
      throw new InternalServerErrorException(
        'No se pudo generar el PDF. Intenta de nuevo en unos minutos.',
      );
    }

    if (!res.ok) {
      // El cuerpo del error trae el detalle de Chromium (plantilla inválida,
      // recurso que no carga...). Se loguea completo pero no se expone al cliente.
      const detail = await res.text().catch(() => '');
      this.logger.error(
        `Gotenberg devolvió ${res.status} al renderizar el PDF. ${detail}`,
      );
      throw new InternalServerErrorException('No se pudo generar el PDF.');
    }

    return Buffer.from(await res.arrayBuffer());
  }

  /**
   * Gotenberg exige que header.html y footer.html sean documentos HTML
   * completos; los callers pasan fragmentos, así que se envuelven.
   */
  private asDocument(fragment: string): string {
    if (/<html[\s>]/i.test(fragment)) return fragment;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
  }

  /** Normaliza un margen a pulgadas, que es lo que espera Gotenberg. */
  private toInches(value: string | number | undefined, fallback: number): string {
    if (value === undefined) return String(fallback);
    if (typeof value === 'number') return String(value);

    const match = /^\s*([\d.]+)\s*(in|cm|mm|pt|px)?\s*$/i.exec(value);
    if (!match) {
      this.logger.warn(`Margen no reconocido: "${value}". Se usa ${fallback}in.`);
      return String(fallback);
    }
    const amount = Number(match[1]);
    const unit = (match[2] ?? 'in').toLowerCase();
    return (amount * (INCHES_PER_UNIT[unit] ?? 1)).toFixed(4);
  }
}
