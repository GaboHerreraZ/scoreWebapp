// Inicialización de Sentry. DEBE importarse antes que cualquier otra cosa en
// main.ts (instrumenta los módulos que se cargan después).
//
// Solo se activa si existe SENTRY_DSN: sin esa env var no hace nada, así local
// y los entornos sin configurar no reportan ni fallan. El DSN, el entorno y la
// tasa de muestreo de performance se controlan por variables de entorno.
import * as Sentry from '@sentry/nestjs';

const dsn = process.env['SENTRY_DSN'];

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env['SENTRY_ENV'] ?? process.env['NODE_ENV'] ?? 'development',
    // Performance/tracing apagado por defecto (cuida la cuota del free tier).
    // Subir gradualmente con SENTRY_TRACES_SAMPLE_RATE si se quiere tracing.
    tracesSampleRate: Number(process.env['SENTRY_TRACES_SAMPLE_RATE'] ?? 0),
  });
}
