import { Logger as NestLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { bootstrapLogger } from './core/logging/logger.options';
import { WorkerModule } from './worker.module';

/**
 * Worker entrypoint: no HTTP server. On SIGTERM, shutdown hooks close the
 * BullMQ workers, which wait for active jobs to finish; unfinished jobs are
 * picked up by another replica once their lock expires.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  new NestLogger('bootstrap').log({
    operation: 'app.start',
    status: 'ok',
    process: 'worker',
  });
}

bootstrap().catch((error: unknown) => {
  bootstrapLogger('nestjs-base-worker').fatal({
    operation: 'app.start',
    module: 'bootstrap',
    status: 'error',
    err: error,
  });
  process.exit(1);
});
