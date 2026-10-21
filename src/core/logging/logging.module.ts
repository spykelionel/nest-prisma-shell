import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { SharedEnvironment } from '../config/env.validation';
import { pinoModuleParams } from './logger.options';

/**
 * Structured logging for every process (nestjs-pino). Imported once by each
 * root module; the entrypoint then routes Nest's own logger through it with
 * `app.useLogger(app.get(Logger))`.
 *
 * Code keeps using `new Logger('<module>')` from @nestjs/common and passes
 * an object: `this.logger.log({ operation, status, durationMs })`. Pass
 * errors as `err: error` to get pino's error serializer.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<SharedEnvironment, true>) =>
        pinoModuleParams({
          service: config.get('SERVICE_NAME', { infer: true }),
          level: config.get('LOG_LEVEL', { infer: true }),
          pretty: config.get('LOG_PRETTY', { infer: true }),
        }),
    }),
  ],
})
export class LoggingModule {}
