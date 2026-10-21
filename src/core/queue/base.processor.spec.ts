import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { requestContext } from '../context/request-context';
import { BaseProcessor, TracedJobData } from './base.processor';

class TestProcessor extends BaseProcessor<TracedJobData, string> {
  seenTraceId: string | undefined;
  constructor(private readonly impl: () => Promise<string>) {
    super('test', 2);
  }
  protected handle(): Promise<string> {
    this.seenTraceId = requestContext.traceId;
    return this.impl();
  }
}

function job(
  data: TracedJobData,
  attemptsMade = 0,
  attempts = 3,
): Job<TracedJobData> {
  return {
    id: '42',
    name: 'test.job',
    data,
    attemptsMade,
    opts: { attempts },
  } as unknown as Job<TracedJobData>;
}

describe('BaseProcessor', () => {
  let errorLog: jest.SpyInstance;

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  beforeEach(() => errorLog.mockClear());

  it('runs the handler under the enqueuing request traceId', async () => {
    const processor = new TestProcessor(() => Promise.resolve('done'));
    await expect(
      processor.process(job({ traceId: 'trace-12345678' })),
    ).resolves.toBe('done');
    expect(processor.seenTraceId).toBe('trace-12345678');
  });

  it('falls back to a job-scoped traceId', async () => {
    const processor = new TestProcessor(() => Promise.resolve('done'));
    await processor.process(job({}));
    expect(processor.seenTraceId).toBe('job-test-42');
  });

  it('rethrows so BullMQ retries, and logs that a retry follows', async () => {
    const processor = new TestProcessor(() =>
      Promise.reject(new Error('S3 timeout')),
    );
    await expect(processor.process(job({}, 0, 3))).rejects.toThrow(
      'S3 timeout',
    );
    expect(errorLog).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'retrying', attempt: 1, attempts: 3 }),
    );
  });

  it('logs the last attempt as failed', async () => {
    const processor = new TestProcessor(() =>
      Promise.reject(new Error('S3 timeout')),
    );
    await expect(processor.process(job({}, 2, 3))).rejects.toThrow();
    expect(errorLog).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', attempt: 3 }),
    );
  });

  it('does not report a retry for unrecoverable errors', async () => {
    const processor = new TestProcessor(() =>
      Promise.reject(new UnrecoverableError('bad payload')),
    );
    await expect(processor.process(job({}, 0, 3))).rejects.toThrow(
      'bad payload',
    );
    expect(errorLog).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
  });
});
