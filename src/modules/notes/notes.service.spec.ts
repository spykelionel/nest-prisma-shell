import { Logger, NotFoundException } from '@nestjs/common';
import { Note } from '@prisma/client';
import { Queue } from 'bullmq';
import { requestContext } from '../../core/context/request-context';
import { NoteSnapshotJobData } from './jobs/note-snapshot.job';
import { NotesRepository } from './notes.repository';
import { NotesService } from './notes.service';

const OWNER = '507f1f77bcf86cd799439011';
const NOTE_ID = '507f1f77bcf86cd799439012';

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: NOTE_ID,
    ownerId: OWNER,
    title: 'Title',
    body: 'Body',
    status: 'ACTIVE',
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('NotesService', () => {
  let repo: jest.Mocked<NotesRepository>;
  let queue: { add: jest.Mock };
  let service: NotesService;
  let errorLog: jest.SpyInstance;

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  beforeEach(() => {
    repo = {
      create: jest.fn(),
      findActiveForOwner: jest.fn(),
      list: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
    } as unknown as jest.Mocked<NotesRepository>;
    queue = { add: jest.fn().mockResolvedValue({}) };
    service = new NotesService(
      repo,
      queue as unknown as Queue<NoteSnapshotJobData>,
    );
    errorLog.mockClear();
  });

  it('enqueues a deterministic, denormalized snapshot job with the traceId', async () => {
    repo.create.mockResolvedValue(note());
    await requestContext.run({ traceId: 'trace-12345678' }, () =>
      service.create(OWNER, { title: 'Title', body: 'Body' }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'note.snapshot',
      {
        traceId: 'trace-12345678',
        noteId: NOTE_ID,
        ownerId: OWNER,
        version: '2026-01-01T00:00:00.000Z',
        title: 'Title',
        body: 'Body',
        status: 'ACTIVE',
      },
      {
        jobId: `note-snapshot_${NOTE_ID}_${Date.parse('2026-01-01T00:00:00Z')}`,
      },
    );
  });

  it('still returns the note when the queue is down, and logs the jobId', async () => {
    repo.create.mockResolvedValue(note());
    queue.add.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      service.create(OWNER, { title: 'Title', body: 'Body' }),
    ).resolves.toMatchObject({
      id: NOTE_ID,
    });
    expect(errorLog).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'notes.enqueueSnapshot',
        noteId: NOTE_ID,
      }),
    );
  });

  it('never exposes deletedAt', async () => {
    repo.create.mockResolvedValue(note());
    const result = await service.create(OWNER, {
      title: 'Title',
      body: 'Body',
    });
    expect(result).not.toHaveProperty('deletedAt');
    expect(repo.create).toHaveBeenCalledWith({
      ownerId: OWNER,
      title: 'Title',
      body: 'Body',
    });
  });

  it('answers 404 for a note owned by someone else', async () => {
    repo.findActiveForOwner.mockResolvedValue(null);
    await expect(
      service.update(OWNER, NOTE_ID, { title: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('soft-deletes only after the ownership check', async () => {
    repo.findActiveForOwner.mockResolvedValue(note());
    await service.remove(OWNER, NOTE_ID);
    expect(repo.findActiveForOwner).toHaveBeenCalledWith(NOTE_ID, OWNER);
    expect(repo.softDelete).toHaveBeenCalledWith(NOTE_ID);
  });

  it('builds page metadata', async () => {
    repo.list.mockResolvedValue([[note()], 41]);
    const page = await service.list(OWNER, {
      page: 2,
      limit: 20,
      sortOrder: 'desc',
      sortBy: 'createdAt',
    });
    expect(repo.list).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: OWNER, skip: 20, take: 20 }),
    );
    expect(page.meta).toEqual({
      page: 2,
      limit: 20,
      total: 41,
      totalPages: 3,
      hasNextPage: true,
    });
  });
});
