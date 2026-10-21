import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Note } from '@prisma/client';
import { Queue } from 'bullmq';
import { requestContext } from '../../core/context/request-context';
import {
  Paginated,
  toPaginated,
  toSkipTake,
} from '../../core/pagination/pagination';
import { QueueName } from '../../core/queue/queue.constants';
import { withTimeout } from '../../core/utils/with-timeout';
import {
  CreateNoteDto,
  ListNotesQueryDto,
  NoteResponseDto,
  UpdateNoteDto,
} from './dto/note.dto';
import {
  NoteJobName,
  NoteSnapshotJobData,
  noteSnapshotJobId,
} from './jobs/note-snapshot.job';
import { NotesRepository } from './notes.repository';

const ENQUEUE_TIMEOUT_MS = 2000;

export const NoteErrorCode = {
  NOT_FOUND: 'NOTE_NOT_FOUND',
} as const;

function toResponse(note: Note): NoteResponseDto {
  return {
    id: note.id,
    ownerId: note.ownerId,
    title: note.title,
    body: note.body,
    status: note.status,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

@Injectable()
export class NotesService {
  private readonly logger = new Logger('notes');

  constructor(
    private readonly notes: NotesRepository,
    @InjectQueue(QueueName.NOTES)
    private readonly queue: Queue<NoteSnapshotJobData>,
  ) {}

  async create(ownerId: string, dto: CreateNoteDto): Promise<NoteResponseDto> {
    const startedAt = Date.now();
    const note = await this.notes.create({
      ownerId,
      title: dto.title,
      body: dto.body,
    });
    this.logger.log({
      operation: 'notes.create',
      status: 'ok',
      noteId: note.id,
      durationMs: Date.now() - startedAt,
    });
    await this.enqueueSnapshot(note);
    return toResponse(note);
  }

  async list(
    ownerId: string,
    query: ListNotesQueryDto,
  ): Promise<Paginated<NoteResponseDto>> {
    const [items, total] = await this.notes.list({
      ownerId,
      status: query.status,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      ...toSkipTake(query),
    });
    return toPaginated(items.map(toResponse), total, query);
  }

  async get(ownerId: string, id: string): Promise<NoteResponseDto> {
    return toResponse(await this.requireOwned(ownerId, id));
  }

  async update(
    ownerId: string,
    id: string,
    dto: UpdateNoteDto,
  ): Promise<NoteResponseDto> {
    await this.requireOwned(ownerId, id);
    const startedAt = Date.now();
    const note = await this.notes.update(id, {
      title: dto.title,
      body: dto.body,
      status: dto.status,
    });
    this.logger.log({
      operation: 'notes.update',
      status: 'ok',
      noteId: id,
      durationMs: Date.now() - startedAt,
    });
    await this.enqueueSnapshot(note);
    return toResponse(note);
  }

  async remove(ownerId: string, id: string): Promise<void> {
    await this.requireOwned(ownerId, id);
    await this.notes.softDelete(id);
    this.logger.log({ operation: 'notes.delete', status: 'ok', noteId: id });
  }

  /**
   * The snapshot is derived data, so a Redis outage must not fail the write
   * the user asked for: the failure is logged with what is needed to replay
   * it. Where losing a job is unacceptable, use a transactional outbox.
   */
  private async enqueueSnapshot(note: Note): Promise<void> {
    const version = note.updatedAt.toISOString();
    const jobId = noteSnapshotJobId(note.id, version);
    try {
      await withTimeout(
        this.queue.add(
          NoteJobName.SNAPSHOT,
          {
            traceId: requestContext.traceId,
            noteId: note.id,
            ownerId: note.ownerId,
            version,
            title: note.title,
            body: note.body,
            status: note.status,
          },
          { jobId },
        ),
        ENQUEUE_TIMEOUT_MS,
        'enqueue',
      );
    } catch (error) {
      this.logger.error({
        operation: 'notes.enqueueSnapshot',
        status: 'error',
        noteId: note.id,
        version,
        jobId,
        err: error,
      });
    }
  }

  /** Someone else's note answers 404, not 403: existence is not disclosed. */
  private async requireOwned(ownerId: string, id: string): Promise<Note> {
    const note = await this.notes.findActiveForOwner(id, ownerId);
    if (!note) {
      throw new NotFoundException({
        code: NoteErrorCode.NOT_FOUND,
        message: 'Note not found',
      });
    }
    return note;
  }
}
