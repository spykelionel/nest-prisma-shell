import { Processor } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Job, UnrecoverableError } from 'bullmq';
import { SharedEnvironment } from '../../../core/config/env.validation';
import { BaseProcessor } from '../../../core/queue/base.processor';
import { QueueName } from '../../../core/queue/queue.constants';
import { isObjectId } from '../../../core/validation/parse-object-id.pipe';
import {
  PutIfAbsentResult,
  StorageService,
} from '../../../core/storage/storage.service';
import {
  NoteJobName,
  NoteSnapshotJobData,
  noteSnapshotKey,
} from './note-snapshot.job';

/**
 * Worker-side only (provided by WorkerModule). Writes an immutable JSON
 * snapshot per note version to object storage. Redis + S3, no MongoDB.
 */
@Processor(QueueName.NOTES)
export class NoteSnapshotProcessor extends BaseProcessor<
  NoteSnapshotJobData,
  { key: string; result: PutIfAbsentResult }
> {
  constructor(
    private readonly storage: StorageService,
    config: ConfigService<SharedEnvironment, true>,
  ) {
    super(QueueName.NOTES, config.get('WORKER_CONCURRENCY', { infer: true }));
  }

  protected async handle(
    job: Job<NoteSnapshotJobData>,
  ): Promise<{ key: string; result: PutIfAbsentResult }> {
    if (job.name !== NoteJobName.SNAPSHOT) {
      throw new UnrecoverableError(
        `Unknown job "${job.name}" on ${QueueName.NOTES}`,
      );
    }
    const data = job.data;
    if (
      !isObjectId(data.noteId) ||
      !isObjectId(data.ownerId) ||
      Number.isNaN(Date.parse(data.version))
    ) {
      throw new UnrecoverableError(
        `Invalid ${NoteJobName.SNAPSHOT} payload for job ${job.id}`,
      );
    }

    const key = noteSnapshotKey(data);
    // Write-once: a retry after a successful write returns 'exists'.
    const result = await this.storage.putIfAbsent({
      key,
      contentType: 'application/json',
      body: JSON.stringify({
        noteId: data.noteId,
        ownerId: data.ownerId,
        version: data.version,
        title: data.title,
        body: data.body,
        status: data.status,
      }),
    });
    return { key, result };
  }
}
