import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { Public } from '../auth/auth.decorators';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import { withTimeout } from '../utils/with-timeout';

/** Bound each dependency probe so a hung dependency fails readiness fast. */
const PROBE_TIMEOUT_MS = 3000;

/**
 * - /health/live: the process is up. No dependencies, so an outage of Mongo
 *   or Redis never gets healthy containers restarted in a loop.
 * - /health/ready: dependencies reachable; take the instance out of rotation
 *   when not.
 */
@ApiTags('health')
@Public()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicators: HealthIndicatorService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.probe('mongodb', () => this.prisma.ping()),
      () => this.probe('redis', () => this.redis.ping()),
    ]);
  }

  private async probe(
    key: string,
    check: () => Promise<unknown>,
  ): Promise<HealthIndicatorResult> {
    const indicator = this.indicators.check(key);
    try {
      await withTimeout(check(), PROBE_TIMEOUT_MS, key);
      return indicator.up();
    } catch (error) {
      return indicator.down({
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
