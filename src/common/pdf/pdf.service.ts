import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import puppeteer, { type Browser, type PDFOptions } from 'puppeteer';

/**
 * Servicio genérico HTML → PDF vía Chromium headless (Puppeteer). Mantiene UN
 * navegador vivo por proceso (singleton) y abre una página nueva por request:
 * lanzar Chromium por cada PDF cuesta ~300-800ms y mucha RAM. Reutilizable por
 * cualquier módulo que necesite renderizar un PDF a partir de HTML autocontenido.
 *
 * El HTML debe traer TODO embebido (CSS inline, sin recursos externos); no se
 * navega a ninguna URL, se inyecta con setContent.
 */
@Injectable()
export class PdfService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PdfService.name);
  private browser: Browser | null = null;
  /** Evita lanzar dos navegadores si llegan requests concurrentes en frío. */
  private launching: Promise<Browser> | null = null;

  async onModuleInit(): Promise<void> {
    // Arranque perezoso: no bloqueamos el boot esperando a Chromium. Se lanza en
    // la primera generación (o aquí, best-effort, sin romper si falla).
    try {
      await this.getBrowser();
    } catch (err) {
      this.logger.warn(
        `No se pudo pre-lanzar Chromium en el arranque; se reintentará en el primer PDF. ${
          (err as Error).message
        }`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => undefined);
      this.browser = null;
    }
  }

  /** Devuelve el navegador vivo, relanzándolo si se cerró/crasheó. */
  private async getBrowser(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;
    if (this.launching) return this.launching;

    this.launching = puppeteer
      .launch({
        // 'shell' usa chrome-headless-shell: el binario recortado de Chrome
        // pensado para page.pdf()/screenshots (~200 MB menos que Chrome
        // completo en la imagen Docker). Puppeteer lo descarga por defecto
        // junto a Chrome, así que en dev local funciona sin pasos extra.
        headless: 'shell',
        // Flags estándar para correr Chromium en servidores (VPS/contenedores)
        // sin sandbox de usuario ni /dev/shm amplio.
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      })
      .then((browser) => {
        this.browser = browser;
        this.launching = null;
        this.logger.log('Chromium headless listo para renderizar PDFs.');
        return browser;
      })
      .catch((err) => {
        this.launching = null;
        throw err;
      });

    return this.launching;
  }

  /**
   * Renderiza un HTML autocontenido a un Buffer PDF. `printBackground` va en
   * true por defecto (obligatorio para los fondos de color de la plantilla).
   */
  async htmlToPdf(html: string, options: PDFOptions = {}): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      // HTML autocontenido (CSS inline, sin recursos externos): con 'load' basta.
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        ...options,
      });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => undefined);
    }
  }
}
