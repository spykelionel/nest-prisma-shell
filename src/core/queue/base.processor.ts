import { WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Job } from 'bullmq';
import { requestContext } from '../context/request-context';

/** Every job payload may carry the traceId of the request that enqueued it. */
export interface TracedJobData {
  traceId?: string;
}

/**
 * Base for every BullMQ processor. Subclasses implement `handle` and must
 * make it idempotent: BullMQ delivers at least once, and any attempt can be
 * a retry of one that partially succeeded.
 *
 * Provides, so subclasses do not repeat it:
 * - the enqueuing request's traceId on every log line of the job
 * - one structured line per attempt (duration, attempt n of m, retry or not)
 * - concurrency applied from config
 *
 * Throwing schedules a retry with backoff; throw bullmq's `UnrecoverableError`
 * for failures a retry cannot fix (invalid payload).
 */
export abstract class BaseProcessor<
  TData extends TracedJobData = TracedJobData,
  TResult = unknown,
>
  extends WorkerHost
  implements OnApplicationBootstrap
{
  protected readonly logger: Logger;

  protected constructor(
    private readonly queueName: string,
    private readonly concurrency: number,
  ) {
    super();
    this.logger = new Logger(`worker.${queueName}`);
  }

  protected abstract handle(job: Job<TData>): Promise<TResult>;

  onApplicationBootstrap(): void {
    this.worker.concurrency = this.concurrency;

    // Connection problems surface here, not in `process`; without a
    // listener a worker stuck on a down Redis is silent.
    this.worker.on('error', (error: NodeJS.ErrnoException) =>
      this.logger.error({
        operation: 'worker.error',
        queue: this.queueName,
        status: 'error',
        code: error.code,
        message: error.message || undefined,
      }),
    );
    // A job whose lock expired (crashed or blocked replica) is re-queued.
    this.worker.on('stalled', (jobId: string) =>
      this.logger.warn({
        operation: 'worker.stalled',
        queue: this.queueName,
        status: 'retrying',
        jobId,
      }),
    );
  }

  async process(job: Job<TData>): Promise<TResult> {
    const traceId =
      typeof job.data?.traceId === 'string' && job.data.traceId
        ? job.data.traceId
        : `job-${this.queueName}-${job.id}`;

    return requestContext.run({ traceId }, async () => {
      const startedAt = Date.now();
      const attempt = job.attemptsMade + 1;
      const attempts = job.opts.attempts ?? 1;
      const base = {
        operation: `job.${job.name}`,
        queue: this.queueName,
        jobId: job.id,
        attempt,
        attempts,
      };

      try {
        const result = await this.handle(job);
        this.logger.log({
          ...base,
          status: 'ok',
          durationMs: Date.now() - startedAt,
        });
        return result;
      } catch (error) {
        const retrying =
          attempt < attempts && (error as Error)?.name !== 'UnrecoverableError';
        this.logger.error({
          ...base,
          status: retrying ? 'retrying' : 'failed',
          durationMs: Date.now() - startedAt,
          err: error,
        });
        throw error;
      }
    });
  }
}
