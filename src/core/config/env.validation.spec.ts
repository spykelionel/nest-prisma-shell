import { validateApiEnv, validateWorkerEnv } from './env.validation';

const valid = {
  DATABASE_URL: 'mongodb://localhost:27017/app?replicaSet=rs0',
  JWT_SECRET: 'x'.repeat(32),
  STORAGE_BUCKET: 'bucket',
  STORAGE_ACCESS_KEY_ID: 'key',
  STORAGE_SECRET_ACCESS_KEY: 'secret',
};

describe('validateApiEnv', () => {
  it('applies defaults and converts numbers', () => {
    const env = validateApiEnv({ ...valid, PORT: '8080' });
    expect(env.PORT).toBe(8080);
    expect(env.REDIS_PORT).toBe(6379);
    expect(env.NODE_ENV).toBe('development');
  });

  it('parses "false" as false (implicit conversion would make it true)', () => {
    const env = validateApiEnv({
      ...valid,
      SWAGGER_ENABLED: 'false',
      REDIS_TLS: '0',
    });
    expect(env.SWAGGER_ENABLED).toBe(false);
    expect(env.REDIS_TLS).toBe(false);
  });

  it('parses "true" as true', () => {
    expect(validateApiEnv({ ...valid, REDIS_TLS: 'true' }).REDIS_TLS).toBe(
      true,
    );
  });

  it('rejects a malformed boolean', () => {
    expect(() => validateApiEnv({ ...valid, REDIS_TLS: 'maybe' })).toThrow(
      /REDIS_TLS/,
    );
  });

  it('lists every missing required variable at once', () => {
    expect(() => validateApiEnv({})).toThrow(
      /DATABASE_URL.*JWT_SECRET|JWT_SECRET.*DATABASE_URL/,
    );
  });

  it('rejects a short JWT secret', () => {
    expect(() => validateApiEnv({ ...valid, JWT_SECRET: 'short' })).toThrow(
      /JWT_SECRET/,
    );
  });

  it('rejects an out-of-range port', () => {
    expect(() => validateApiEnv({ ...valid, PORT: '70000' })).toThrow(/PORT/);
  });
});

describe('validateWorkerEnv', () => {
  it('boots without database or JWT variables', () => {
    const { DATABASE_URL: _db, JWT_SECRET: _jwt, ...workerEnv } = valid;
    const env = validateWorkerEnv(workerEnv);
    expect(env).not.toHaveProperty('DATABASE_URL');
    expect(env).not.toHaveProperty('JWT_SECRET');
  });

  it('still requires storage credentials', () => {
    expect(() => validateWorkerEnv({})).toThrow(/STORAGE_BUCKET/);
  });
});
