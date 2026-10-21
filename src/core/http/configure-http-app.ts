import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { EnvironmentVariables } from '../config/env.validation';
import { requestContextMiddleware } from '../context/request-context.middleware';
import { HttpExceptionFilter } from './http-exception.filter';
import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor';

/**
 * Everything the HTTP surface needs, in order. Shared by `main.ts` and e2e
 * tests so both run the same pipeline.
 */
export function configureHttpApp(app: NestExpressApplication): void {
  const config =
    app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);

  // Without the hop count req.ip is the proxy's address; with it, Express
  // also ignores X-Forwarded-For entries it was not told to trust.
  app.set('trust proxy', config.get('TRUST_PROXY_HOPS', { infer: true }));

  // First: everything below (including pino-http) logs inside the trace scope.
  app.use(requestContextMiddleware);

  const swaggerEnabled = config.get('SWAGGER_ENABLED', { infer: true });
  // Swagger UI needs inline scripts; the API itself only serves JSON.
  app.use(
    helmet({ contentSecurityPolicy: swaggerEnabled ? false : undefined }),
  );

  const bodyLimit = config.get('BODY_LIMIT', { infer: true });
  app.useBodyParser('json', { limit: bodyLimit });
  app.useBodyParser('urlencoded', { limit: bodyLimit, extended: true });

  const origins = config
    .get('CORS_ORIGINS', { infer: true })
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (origins.length > 0) {
    app.enableCors({ origin: origins, credentials: true });
  }

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  app.enableShutdownHooks();

  if (swaggerEnabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle(config.get('SERVICE_NAME', { infer: true }))
        .setVersion('1')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('docs', app, document);
  }
}
