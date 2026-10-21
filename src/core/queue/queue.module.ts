import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SharedEnvironment } from '../config/env.validation';
import { redisConnectionOptions } from '../redis/redis-connection';
import { DEFAULT_JOB_OPTIONS, QueueName } from './queue.constants';

export type QueueRole = 'producer' | 'worker';

/**
 * BullMQ wiring for one process.
 *
 * - producer (API): commands fail fast when Redis is down, so an enqueue
 *   cannot hang an HTTP request.
 * - worker: commands wait for Redis indefinitely, as BullMQ workers require
 *   (`maxRetriesPerRequest: null`).
 *
 * Processors are provided only by WorkerModule, so the API never consumes.
 */
@Module({})
export class QueueModule {
  static forRoot(role: QueueRole): DynamicModule {
    return {
      module: QueueModule,
      global: true,
      imports: [
        BullModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService<SharedEnvironment, true>) => ({
            prefix: config.get('QUEUE_PREFIX', { infer: true }),
            connection: {
              ...redisConnectionOptions(config),
              ...(role === 'worker'
                ? { maxRetriesPerRequest: null }
                : { maxRetriesPerRequest: 1, enableOfflineQueue: false }),
            },
            defaultJobOptions: DEFAULT_JOB_OPTIONS,
          }),
        }),
        BullModule.registerQueue(
          ...Object.values(QueueName).map((name) => ({ name })),
        ),
      ],
      exports: [BullModule],
    };
  }
}
