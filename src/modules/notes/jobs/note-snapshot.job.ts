// Type-only imports: this contract is shared with the worker, which must not
// load the Prisma runtime.
import type { NoteStatus } from '@prisma/client';
import type { TracedJobData } from '../../../core/queue/base.processor';

export const NoteJobName = {
  SNAPSHOT: 'note.snapshot',
} as const;

/**
 * Everything the worker needs, copied at enqueue time: workers never read
 * MongoDB. The same payload always produces the same object, so retries are
 * deterministic.
 */
export interface NoteSnapshotJobData extends TracedJobData {
  noteId: string;
  ownerId: string;
  /** ISO timestamp of the note's updatedAt: identifies the version. */
  version: string;
  title: string;
  body: string;
  status: NoteStatus;
}

/**
 * One job per note version. BullMQ ignores an add with an existing jobId, so
 * a double submit enqueues once. (`:` is reserved by BullMQ in custom ids.)
 */
export function noteSnapshotJobId(noteId: string, version: string): string {
  return `note-snapshot_${noteId}_${Date.parse(version)}`;
}

export function noteSnapshotKey(data: NoteSnapshotJobData): string {
  return `notes/${data.ownerId}/${data.noteId}/snapshots/${Date.parse(data.version)}.json`;
}
