// IMPORTANTE: debe ir antes que cualquier otro import para instrumentar Sentry
// a tiempo (no hace nada si SENTRY_DSN no está definido).
import './instrument.js';

import { NestFactory, HttpAdapterHost } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { i18nValidationExceptionFactory } from './common/pipes/i18n-validation.factory.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Global prefix
  app.setGlobalPrefix('api');

  // Filtro global de excepciones: captura, loguea con contexto y (si hay
  // SENTRY_DSN) reporta a Sentry toda excepción no manejada.
  app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));

  // CORS
  const allowedOrigins = process.env['CORS_ORIGINS']
    ? process.env['CORS_ORIGINS'].split(',')
    : ['http://localhost:4200', 'http://localhost:4300'];

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    exposedHeaders: ['Content-Disposition'],
  });

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: i18nValidationExceptionFactory,
    }),
  );

  // Swagger
  const config = new DocumentBuilder()
    .setTitle('WebApp API')
    .setDescription('API para la aplicación WebApp')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = process.env['PORT'] ?? 3000;
  await app.listen(port);
  console.log(`Server running on http://localhost:${port}`);
  console.log(`Swagger docs on http://localhost:${port}/docs`);
}
bootstrap();
