import { Logger as NestLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { EnvironmentVariables } from './core/config/env.validation';
import { configureHttpApp } from './core/http/configure-http-app';
import { bootstrapLogger } from './core/logging/logger.options';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Held until useLogger below, so startup lines go through pino too.
    bufferLogs: true,
    // configureHttpApp registers body parsers with the configured limit.
    bodyParser: false,
  });
  app.useLogger(app.get(Logger));

  configureHttpApp(app);

  const config =
    app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
  const port = config.get('PORT', { infer: true });
  await app.listen(port, '0.0.0.0');

  new NestLogger('bootstrap').log({
    operation: 'app.start',
    status: 'ok',
    process: 'api',
    port,
  });
}

bootstrap().catch((error: unknown) => {
  bootstrapLogger('nestjs-base').fatal({
    operation: 'app.start',
    module: 'bootstrap',
    status: 'error',
    err: error,
  });
  process.exit(1);
});
