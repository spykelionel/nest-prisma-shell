import { Module } from '@nestjs/common';
import { AppConfigModule } from './core/config/app-config.module';
import { LoggingModule } from './core/logging/logging.module';
import { QueueModule } from './core/queue/queue.module';
import { StorageModule } from './core/storage/storage.module';
import { NoteSnapshotProcessor } from './modules/notes/jobs/note-snapshot.processor';

/**
 * Root of the worker process: Redis (via BullMQ) and object storage only.
 *
 * DatabaseModule is deliberately absent — workers never query MongoDB.
 * Jobs carry the data they need. Scale by running more worker replicas;
 * BullMQ distributes jobs across them.
 */
@Module({
  imports: [
    AppConfigModule.forRoot('worker'),
    LoggingModule,
    QueueModule.forRoot('worker'),
    StorageModule,
  ],
  providers: [NoteSnapshotProcessor],
})
export class WorkerModule {}
