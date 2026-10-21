import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { SharedEnvironment } from '../config/env.validation';
import { redisConnectionOptions } from './redis-connection';
import { REDIS_CLIENT, RedisService } from './redis.service';

/** Cache client. Queues use their own connections (see QueueModule). */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<SharedEnvironment, true>) => {
        const logger = new Logger('redis');
        const client = new Redis({
          ...redisConnectionOptions(config),
          keyPrefix: config.get('REDIS_KEY_PREFIX', { infer: true }),
          // Fail cache calls fast during an outage instead of queueing them.
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
        });
        client.on('error', (error: NodeJS.ErrnoException) =>
          logger.warn({
            operation: 'redis.connection',
            status: 'error',
            // ECONNREFUSED arrives as an AggregateError with an empty message.
            code: error.code,
            message: error.message || undefined,
          }),
        );
        client.on('ready', () =>
          logger.log({ operation: 'redis.connection', status: 'ok' }),
        );
        return client;
      },
    },
    RedisService,
  ],
  exports: [RedisService],
})
export class RedisModule {}
