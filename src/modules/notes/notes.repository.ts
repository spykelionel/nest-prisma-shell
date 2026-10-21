import { Injectable } from '@nestjs/common';
import { Note, NoteStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { NoteSortField } from './dto/note.dto';

export interface NoteListFilter {
  ownerId: string;
  status?: NoteStatus;
  skip: number;
  take: number;
  sortBy: NoteSortField;
  sortOrder: 'asc' | 'desc';
}

/**
 * Database access for notes and nothing else: no HTTP exceptions, no
 * business rules. Every read excludes soft-deleted rows and is shaped to
 * hit an index declared in schema.prisma.
 */
@Injectable()
export class NotesRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: {
    ownerId: string;
    title: string;
    body: string;
  }): Promise<Note> {
    // deletedAt written explicitly so `deletedAt: null` filters match it.
    return this.prisma.note.create({ data: { ...data, deletedAt: null } });
  }

  findActiveForOwner(id: string, ownerId: string): Promise<Note | null> {
    return this.prisma.note.findFirst({
      where: { id, ownerId, deletedAt: null },
    });
  }

  async list(filter: NoteListFilter): Promise<[Note[], number]> {
    const where: Prisma.NoteWhereInput = {
      ownerId: filter.ownerId,
      deletedAt: null,
      ...(filter.status ? { status: filter.status } : {}),
    };
    // Two reads instead of $transaction: a count that is a moment stale is
    // acceptable for pagination and avoids a multi-document transaction.
    return Promise.all([
      this.prisma.note.findMany({
        where,
        orderBy: { [filter.sortBy]: filter.sortOrder },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.note.count({ where }),
    ]);
  }

  update(
    id: string,
    data: Pick<Prisma.NoteUpdateInput, 'title' | 'body' | 'status'>,
  ): Promise<Note> {
    return this.prisma.note.update({ where: { id }, data });
  }

  softDelete(id: string): Promise<Note> {
    return this.prisma.note.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
