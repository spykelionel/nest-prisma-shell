import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * Cache access. Redis is a cache here, never the source of truth: a miss
 * (or an outage) must always be recoverable from MongoDB, so reads degrade
 * to `undefined` and writes to a no-op, both logged.
 *
 * Keys are namespaced by REDIS_KEY_PREFIX via the client's keyPrefix.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger('redis');

  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async getJson<T>(key: string): Promise<T | undefined> {
    try {
      const raw = await this.client.get(key);
      return raw === null ? undefined : (JSON.parse(raw) as T);
    } catch (error) {
      this.fail('redis.get', key, error);
      return undefined;
    }
  }

  async setJson(
    key: string,
    value: unknown,
    ttlSeconds: number,
  ): Promise<void> {
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.fail('redis.set', key, error);
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.client.del(...keys);
    } catch (error) {
      this.fail('redis.del', keys.join(','), error);
    }
  }

  /** Throws on failure — used by readiness checks. */
  async ping(): Promise<void> {
    await this.client.ping();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }

  private fail(operation: string, key: string, error: unknown): void {
    this.logger.warn({
      operation,
      status: 'error',
      key,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
