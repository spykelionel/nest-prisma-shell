import { ConsoleLogger, Logger as NestLogger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IncomingMessage, ServerResponse } from 'http';
import { Logger, LoggerModule } from 'nestjs-pino';
import pino from 'pino';
import { Writable } from 'stream';
import { requestContext } from '../context/request-context';
import {
  baseLoggerOptions,
  httpLoggerOptions,
  LoggerSettings,
} from './logger.options';

const settings: LoggerSettings = {
  service: 'svc',
  level: 'debug',
  pretty: false,
};

/** Collects every JSON line pino writes. */
function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, done) {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        lines.push(JSON.parse(line) as Record<string, unknown>);
      }
      done();
    },
  });
  return { lines, stream };
}

describe('baseLoggerOptions', () => {
  it('writes text level, ISO time, service and the context traceId', () => {
    const { lines, stream } = capture();
    const logger = pino(baseLoggerOptions(settings), stream);

    requestContext.run({ traceId: 'trace-12345678', userId: 'u1' }, () =>
      logger.info({ operation: 'notes.create', status: 'ok' }),
    );

    expect(lines[0]).toMatchObject({
      level: 'info',
      service: 'svc',
      traceId: 'trace-12345678',
      userId: 'u1',
      operation: 'notes.create',
      status: 'ok',
    });
    expect(new Date(lines[0].time as string).toISOString()).toBe(lines[0].time);
  });

  it('does not let a log call spoof the traceId', () => {
    const { lines, stream } = capture();
    const logger = pino(baseLoggerOptions(settings), stream);
    requestContext.run({ traceId: 'trace-12345678' }, () =>
      logger.info({ traceId: 'spoofed' }),
    );
    expect(lines[0].traceId).toBe('trace-12345678');
  });

  it('omits traceId outside a scope', () => {
    const { lines, stream } = capture();
    pino(baseLoggerOptions(settings), stream).info('boot');
    expect(lines[0]).not.toHaveProperty('traceId');
  });

  it('redacts credentials', () => {
    const { lines, stream } = capture();
    pino(baseLoggerOptions(settings), stream).info({
      req: { headers: { authorization: 'Bearer abc', cookie: 'sid=1' } },
      user: { password: 'hunter2' },
    });
    expect(JSON.stringify(lines[0])).not.toMatch(/abc|sid=1|hunter2/);
  });

  it('serializes errors passed as err', () => {
    const { lines, stream } = capture();
    pino(baseLoggerOptions(settings), stream).error({ err: new Error('boom') });
    expect(lines[0].err).toMatchObject({ type: 'Error', message: 'boom' });
    expect((lines[0].err as { stack: string }).stack).toContain('boom');
  });
});

describe('httpLoggerOptions', () => {
  const options = httpLoggerOptions(settings);
  const res = (statusCode: number) => ({ statusCode }) as ServerResponse;
  const req = {} as IncomingMessage;

  it('maps status codes to levels', () => {
    expect(options.customLogLevel?.(req, res(200), undefined)).toBe('info');
    expect(options.customLogLevel?.(req, res(404), undefined)).toBe('warn');
    expect(options.customLogLevel?.(req, res(503), undefined)).toBe('error');
    expect(options.customLogLevel?.(req, res(200), new Error('x'))).toBe(
      'error',
    );
  });

  it('skips health probes', () => {
    const ignore = (
      options.autoLogging as { ignore: (r: IncomingMessage) => boolean }
    ).ignore;
    expect(ignore({ url: '/health/ready' } as IncomingMessage)).toBe(true);
    expect(ignore({ url: '/v1/notes?page=2' } as IncomingMessage)).toBe(false);
  });

  it('logs method and path only, never the query string', () => {
    const serialize = options.serializers?.req as (r: object) => object;
    expect(serialize({ method: 'GET', url: '/v1/notes?token=abc' })).toEqual({
      method: 'GET',
      path: '/v1/notes',
    });
  });

  it('emits traceId once on a request-bound child logger', () => {
    const chunks: string[] = [];
    const raw = new Writable({
      write(chunk: Buffer, _enc, done) {
        chunks.push(chunk.toString());
        done();
      },
    });
    const child = pino(baseLoggerOptions(settings), raw).child({
      traceId: 'trace-12345678',
    });
    requestContext.run({ traceId: 'trace-12345678' }, () => child.info('x'));
    expect(chunks[0].match(/"traceId"/g)).toHaveLength(1);
  });

  it('reuses the request-context traceId as the request id', () => {
    const id = requestContext.run({ traceId: 'trace-12345678' }, () =>
      (options.genReqId as () => string)(),
    );
    expect(id).toBe('trace-12345678');
  });
});

describe('nestjs-pino with Nest Logger call sites', () => {
  afterEach(() => {
    NestLogger.overrideLogger(new ConsoleLogger());
  });

  it('renders `new Logger(ctx).log({...})` as one line with module', async () => {
    const { lines, stream } = capture();
    const moduleRef = await Test.createTestingModule({
      imports: [
        LoggerModule.forRoot({
          pinoHttp: [httpLoggerOptions(settings), stream],
          renameContext: 'module',
        }),
      ],
    }).compile();
    NestLogger.overrideLogger(moduleRef.get(Logger));

    const logger = new NestLogger('notes');
    requestContext.run({ traceId: 'trace-12345678' }, () => {
      logger.log({ operation: 'notes.create', status: 'ok', durationMs: 3 });
      logger.error({
        operation: 'notes.enqueueSnapshot',
        status: 'error',
        err: new Error('ECONNREFUSED'),
      });
    });

    expect(lines[0]).toMatchObject({
      level: 'info',
      module: 'notes',
      traceId: 'trace-12345678',
      operation: 'notes.create',
      durationMs: 3,
    });
    expect(lines[1]).toMatchObject({
      level: 'error',
      module: 'notes',
      operation: 'notes.enqueueSnapshot',
      err: { message: 'ECONNREFUSED' },
    });
    await moduleRef.close();
  });
});
