import { randomUUID } from 'crypto';
import { IncomingMessage, ServerResponse } from 'http';
import { hostname } from 'os';
import { Params } from 'nestjs-pino';
import pino, { Level, LoggerOptions } from 'pino';
import { Options as PinoHttpOptions } from 'pino-http';
import { requestContext } from '../context/request-context';

export interface LoggerSettings {
  service: string;
  level: Level;
  pretty: boolean;
}

/** Probes would drown real traffic. */
const QUIET_PATHS = ['/health/live', '/health/ready'];

/**
 * Defence in depth: request lines are already serialized down to
 * method/path/status, but anything a developer logs by hand is scrubbed too.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
];

const pathOf = (url: string | undefined): string => (url ?? '').split('?')[0];

/**
 * pino settings shared by every process: one JSON object per line with
 * ISO `time`, text `level`, `service`, `hostname`, `pid`, and — inside a
 * request or job scope — `traceId` / `userId` from the request context.
 *
 * The context fields come from our AsyncLocalStorage (not nestjs-pino's
 * request-bound logger) so they are present in worker jobs as well.
 */
export function baseLoggerOptions(settings: LoggerSettings): LoggerOptions {
  return {
    level: settings.level,
    base: { service: settings.service, hostname: hostname(), pid: process.pid },
    messageKey: 'msg',
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    mixin: (_mergeObject, _level, logger) => {
      const ctx = requestContext.get();
      if (!ctx) return {};
      const fields: Record<string, string> = ctx.userId
        ? { traceId: ctx.traceId, userId: ctx.userId }
        : { traceId: ctx.traceId };
      // pino-http's per-request logger already binds traceId (reqId key);
      // repeating it would emit a duplicate JSON key.
      if (logger && 'traceId' in logger.bindings()) delete fields.traceId;
      return fields;
    },
    // Context wins over the log call: a message cannot spoof traceId/userId.
    mixinMergeStrategy: (mergeObject: object, mixinObject: object) =>
      Object.assign(mergeObject, mixinObject),
    serializers: { err: pino.stdSerializers.err },
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    ...(settings.pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { singleLine: true, translateTime: 'SYS:HH:MM:ss.l' },
          },
        }
      : {}),
  };
}

/**
 * Request logging (pino-http): one line per finished request with
 * operation/method/path/statusCode/durationMs/status. Never bodies, query
 * strings or headers.
 */
export function httpLoggerOptions(settings: LoggerSettings): PinoHttpOptions {
  return {
    ...baseLoggerOptions(settings),
    // Same id as the x-request-id header set by requestContextMiddleware,
    // which runs first (app.use precedes module middleware).
    genReqId: () => requestContext.traceId ?? randomUUID(),
    customAttributeKeys: { reqId: 'traceId', responseTime: 'durationMs' },
    // Child loggers bound to a request carry only the id, not the request.
    quietReqLogger: true,
    autoLogging: {
      ignore: (req: IncomingMessage) =>
        QUIET_PATHS.some((p) => pathOf(req.url).endsWith(p)),
    },
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    customSuccessMessage: () => 'request completed',
    customErrorMessage: () => 'request failed',
    customSuccessObject: (_req, res: ServerResponse, value: object) => ({
      ...value,
      operation: 'http.request',
      status: res.statusCode >= 500 ? 'error' : 'ok',
    }),
    customErrorObject: (_req, _res, _err, value: object) => ({
      ...value,
      operation: 'http.request',
      status: 'error',
    }),
    serializers: {
      err: pino.stdSerializers.err,
      req: (req: { method?: string; url?: string }) => ({
        method: req.method,
        path: pathOf(req.url),
      }),
      res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
    },
  };
}

/** nestjs-pino module params. `module` carries the Nest Logger context. */
export function pinoModuleParams(settings: LoggerSettings): Params {
  return {
    pinoHttp: httpLoggerOptions(settings),
    renameContext: 'module',
  };
}

/**
 * For failures before the Nest container (and its configuration) exists.
 * Reads the two values it needs from the environment directly; both are
 * re-validated by ConfigModule as soon as the container starts.
 */
export function bootstrapLogger(fallbackService: string): pino.Logger {
  return pino(
    baseLoggerOptions({
      service: process.env.SERVICE_NAME || fallbackService,
      level: 'info',
      pretty: false,
    }),
  );
}
