import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { EnvironmentVariables } from '../config/env.validation';
import { withTimeout } from '../utils/with-timeout';

type LoggedEvents = 'warn' | 'error';

const BOOT_PING_TIMEOUT_MS = 5000;

/**
 * Adds driver pool options to the connection string unless the URL already
 * sets them, so operators can still override per environment.
 */
export function withPoolOptions(
  url: string,
  options: Record<string, number>,
): string {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(options)) {
    if (!parsed.searchParams.has(key)) {
      parsed.searchParams.set(key, String(value));
    }
  }
  return parsed.toString();
}

/**
 * The only MongoDB client in the API process. Repositories inject this;
 * services and controllers never do. Not imported by WorkerModule —
 * workers do not touch MongoDB.
 */
@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, LoggedEvents>
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger('database');

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    super({
      datasourceUrl: withPoolOptions(
        config.get('DATABASE_URL', { infer: true }),
        {
          maxPoolSize: config.get('DB_MAX_POOL_SIZE', { infer: true }),
          minPoolSize: config.get('DB_MIN_POOL_SIZE', { infer: true }),
          serverSelectionTimeoutMS: config.get(
            'DB_SERVER_SELECTION_TIMEOUT_MS',
            { infer: true },
          ),
        },
      ),
      log: [
        { level: 'warn', emit: 'event' },
        { level: 'error', emit: 'event' },
      ],
    });

    this.$on('warn', (e) =>
      this.logger.warn({ operation: 'prisma.warn', message: e.message }),
    );
    this.$on('error', (e) =>
      this.logger.error({
        operation: 'prisma.error',
        status: 'error',
        message: e.message,
        target: e.target,
      }),
    );
  }

  /**
   * On MongoDB, `$connect` succeeds without reaching the server, so a ping
   * is what tells the operator at boot whether the database is reachable.
   * An unreachable database is logged, not fatal: /health/ready keeps the
   * instance out of rotation until it recovers. A malformed DATABASE_URL
   * still throws here and fails the deploy.
   */
  async onModuleInit(): Promise<void> {
    const startedAt = Date.now();
    await this.$connect();
    try {
      await withTimeout(this.ping(), BOOT_PING_TIMEOUT_MS, 'mongodb ping');
      this.logger.log({
        operation: 'prisma.connect',
        status: 'ok',
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      this.logger.warn({
        operation: 'prisma.connect',
        status: 'degraded',
        durationMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Cheap round trip for readiness checks. */
  async ping(): Promise<void> {
    await this.$runCommandRaw({ ping: 1 });
  }
}
