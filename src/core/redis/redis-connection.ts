import { ConfigService } from '@nestjs/config';
import { RedisOptions } from 'ioredis';
import { SharedEnvironment } from '../config/env.validation';

/**
 * Connection settings shared by the cache client and BullMQ. Deliberately
 * without `keyPrefix`: BullMQ refuses ioredis key prefixes and namespaces
 * its keys with QUEUE_PREFIX instead.
 */
export function redisConnectionOptions(
  config: ConfigService<SharedEnvironment, true>,
): RedisOptions {
  return {
    host: config.get('REDIS_HOST', { infer: true }),
    port: config.get('REDIS_PORT', { infer: true }),
    password: config.get('REDIS_PASSWORD', { infer: true }) || undefined,
    db: config.get('REDIS_DB', { infer: true }),
    ...(config.get('REDIS_TLS', { infer: true }) ? { tls: {} } : {}),
    // Back off up to 5s between reconnects instead of hammering a down Redis.
    retryStrategy: (attempt: number) => Math.min(attempt * 200, 5000),
  };
}
