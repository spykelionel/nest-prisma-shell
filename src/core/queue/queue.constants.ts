import { JobsOptions } from 'bullmq';

/**
 * Every queue in the system, registered once by QueueModule for both the API
 * (producer) and the worker (consumer). Add new queues here.
 */
export const QueueName = {
  NOTES: 'notes',
} as const;

export type QueueName = (typeof QueueName)[keyof typeof QueueName];

/**
 * Retries with exponential backoff (2s, 4s, 8s, 16s, 32s). Finished jobs are
 * trimmed so Redis stays bounded; failed ones are kept longer for inspection.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};
