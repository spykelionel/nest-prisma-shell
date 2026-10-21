import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, UnrecoverableError } from 'bullmq';
import { SharedEnvironment } from '../../../core/config/env.validation';
import { StorageService } from '../../../core/storage/storage.service';
import { NoteSnapshotJobData } from './note-snapshot.job';
import { NoteSnapshotProcessor } from './note-snapshot.processor';

const data: NoteSnapshotJobData = {
  traceId: 'trace-12345678',
  noteId: '507f1f77bcf86cd799439012',
  ownerId: '507f1f77bcf86cd799439011',
  version: '2026-01-01T00:00:00.000Z',
  title: 'Title',
  body: 'Body',
  status: 'ACTIVE',
};

function job(
  payload: NoteSnapshotJobData,
  name = 'note.snapshot',
): Job<NoteSnapshotJobData> {
  return {
    id: '1',
    name,
    data: payload,
    attemptsMade: 0,
    opts: { attempts: 5 },
  } as unknown as Job<NoteSnapshotJobData>;
}

describe('NoteSnapshotProcessor', () => {
  let storage: { putIfAbsent: jest.Mock };
  let processor: NoteSnapshotProcessor;

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  beforeEach(() => {
    storage = { putIfAbsent: jest.fn().mockResolvedValue('created') };
    const config = { get: () => 3 } as unknown as ConfigService<
      SharedEnvironment,
      true
    >;
    processor = new NoteSnapshotProcessor(
      storage as unknown as StorageService,
      config,
    );
  });

  it('writes once to a key derived only from the payload', async () => {
    await expect(processor.process(job(data))).resolves.toEqual({
      key: `notes/${data.ownerId}/${data.noteId}/snapshots/${Date.parse(data.version)}.json`,
      result: 'created',
    });
    const written = storage.putIfAbsent.mock.calls[0][0] as { body: string };
    expect(JSON.parse(written.body)).not.toHaveProperty('traceId');
  });

  it('is idempotent: a retry after a successful write succeeds without rewriting', async () => {
    storage.putIfAbsent
      .mockResolvedValueOnce('created')
      .mockResolvedValueOnce('exists');
    const first = await processor.process(job(data));
    const retry = await processor.process(job(data));
    expect(retry).toEqual({ key: first.key, result: 'exists' });
    // Same deterministic input both times.
    expect(storage.putIfAbsent.mock.calls[0][0]).toEqual(
      storage.putIfAbsent.mock.calls[1][0],
    );
  });

  it('propagates storage failures so the job is retried', async () => {
    storage.putIfAbsent.mockRejectedValue(new Error('503 SlowDown'));
    await expect(processor.process(job(data))).rejects.toThrow('503 SlowDown');
  });

  it('refuses malformed payloads without retrying', async () => {
    await expect(
      processor.process(job({ ...data, noteId: 'nope' })),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(
      processor.process(job(data, 'unknown.job')),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(storage.putIfAbsent).not.toHaveBeenCalled();
  });
});
