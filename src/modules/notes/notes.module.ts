import { Module } from '@nestjs/common';
import { NotesController } from './notes.controller';
import { NotesRepository } from './notes.repository';
import { NotesService } from './notes.service';

/**
 * Example feature module showing the layering. Copy its shape for new
 * features; delete it (and the Note model) when no longer needed.
 */
@Module({
  controllers: [NotesController],
  providers: [NotesService, NotesRepository],
})
export class NotesModule {}
