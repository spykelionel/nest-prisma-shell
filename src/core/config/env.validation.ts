import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MinLength,
  Min,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

/** pino level names. Nest's `log` maps to `info`, `verbose` to `trace`. */
export enum LogLevel {
  Fatal = 'fatal',
  Error = 'error',
  Warn = 'warn',
  Info = 'info',
  Debug = 'debug',
  Trace = 'trace',
}

/**
 * Env vars are strings, and class-transformer's implicit conversion turns
 * every non-empty string ("false" included) into `true` *before* custom
 * transforms run. So read the raw value from `obj`, not `value`.
 */
const toBoolean = ({
  obj,
  key,
  value: converted,
}: {
  obj: Record<string, unknown>;
  key: string;
  value: unknown;
}): unknown => {
  const value = key in obj ? obj[key] : converted;
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no', ''].includes(normalized)) return false;
  return value;
};

/**
 * Variables every process reads (API and worker), typed and validated once
 * at boot. Read through `ConfigService<SharedEnvironment, true>` with
 * `{ infer: true }` — never through `process.env`.
 *
 * Every property carries an explicit type annotation: class-transformer
 * converts by the emitted `design:type`, which inferred types do not get.
 */
export class SharedEnvironment {
  // --- runtime ---------------------------------------------------------
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  /** Name stamped on every log line as `service`. */
  @IsString()
  SERVICE_NAME: string = 'nestjs-base';

  @IsEnum(LogLevel)
  LOG_LEVEL: LogLevel = LogLevel.Info;

  /**
   * Human-readable output via pino-pretty (a devDependency). Local use
   * only: production images do not contain it, and the boot fails if set.
   */
  @Transform(toBoolean)
  @IsBoolean()
  LOG_PRETTY: boolean = false;

  // --- redis -----------------------------------------------------------
  @IsString()
  REDIS_HOST: string = 'localhost';

  @IsInt()
  @Min(1)
  @Max(65535)
  REDIS_PORT: number = 6379;

  @IsOptional()
  @IsString()
  REDIS_PASSWORD?: string;

  @IsInt()
  @Min(0)
  REDIS_DB: number = 0;

  @Transform(toBoolean)
  @IsBoolean()
  REDIS_TLS: boolean = false;

  /** Prefix for cache keys, so several services can share one Redis. */
  @IsString()
  REDIS_KEY_PREFIX: string = 'nestjs-base:';

  // --- queues ----------------------------------------------------------
  /** BullMQ key prefix. Must match between API and workers. */
  @IsString()
  QUEUE_PREFIX: string = 'nestjs-base-bull';

  @IsInt()
  @Min(1)
  WORKER_CONCURRENCY: number = 5;

  // --- object storage (S3 / R2 / MinIO) --------------------------------
  /** Custom endpoint for S3-compatible providers. Unset for AWS S3. */
  @IsOptional()
  @IsString()
  STORAGE_ENDPOINT?: string;

  @IsString()
  STORAGE_REGION: string = 'auto';

  @IsString()
  @MinLength(3)
  STORAGE_BUCKET: string;

  @IsString()
  @MinLength(1)
  STORAGE_ACCESS_KEY_ID: string;

  @IsString()
  @MinLength(1)
  STORAGE_SECRET_ACCESS_KEY: string;

  /** Required by MinIO; R2 and S3 work with virtual-hosted style. */
  @Transform(toBoolean)
  @IsBoolean()
  STORAGE_FORCE_PATH_STYLE: boolean = false;

  @IsInt()
  @Min(60)
  @Max(604800)
  STORAGE_PRESIGN_TTL_SECONDS: number = 900;
}

/**
 * The API process: shared variables plus HTTP, database and auth. Workers
 * validate SharedEnvironment only, so they are never handed database
 * credentials or the JWT secret.
 */
export class EnvironmentVariables extends SharedEnvironment {
  // --- http ------------------------------------------------------------
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  /** Number of reverse proxies in front of the API; 0 when exposed directly. */
  @IsInt()
  @Min(0)
  TRUST_PROXY_HOPS: number = 0;

  /** Comma-separated allowlist. Empty disables CORS (same-origin only). */
  @IsString()
  CORS_ORIGINS: string = '';

  @IsString()
  BODY_LIMIT: string = '1mb';

  @Transform(toBoolean)
  @IsBoolean()
  SWAGGER_ENABLED: boolean = true;

  // --- database --------------------------------------------------------
  @IsString()
  @MinLength(1)
  DATABASE_URL: string;

  @IsInt()
  @Min(1)
  DB_MAX_POOL_SIZE: number = 20;

  @IsInt()
  @Min(0)
  DB_MIN_POOL_SIZE: number = 2;

  @IsInt()
  @Min(1)
  DB_SERVER_SELECTION_TIMEOUT_MS: number = 10000;

  // --- auth ------------------------------------------------------------
  @IsString()
  @MinLength(32)
  JWT_SECRET: string;

  /** Lifetime of access tokens this service signs. */
  @IsInt()
  @Min(60)
  JWT_EXPIRES_IN_SECONDS: number = 900;

  @IsOptional()
  @IsString()
  JWT_ISSUER?: string;

  @IsOptional()
  @IsString()
  JWT_AUDIENCE?: string;
}

function validateAgainst<T extends object>(
  schema: new () => T,
  config: Record<string, unknown>,
): T {
  const validated = plainToInstance(schema, config, {
    enableImplicitConversion: true,
    exposeDefaultValues: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const details = errors
      .map(
        (e) =>
          `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
      )
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return validated;
}

/**
 * ConfigModule `validate` hooks: fail the boot with every problem listed,
 * rather than at first use.
 */
export const validateApiEnv = (
  config: Record<string, unknown>,
): EnvironmentVariables => validateAgainst(EnvironmentVariables, config);

export const validateWorkerEnv = (
  config: Record<string, unknown>,
): SharedEnvironment => validateAgainst(SharedEnvironment, config);
