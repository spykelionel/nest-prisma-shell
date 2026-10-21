import { Module } from '@nestjs/common';
import { CoreAuthModule } from './core/auth/core-auth.module';
import { AppConfigModule } from './core/config/app-config.module';
import { DatabaseModule } from './core/database/database.module';
import { HealthModule } from './core/health/health.module';
import { LoggingModule } from './core/logging/logging.module';
import { QueueModule } from './core/queue/queue.module';
import { RedisModule } from './core/redis/redis.module';
import { StorageModule } from './core/storage/storage.module';
import { NotesModule } from './modules/notes/notes.module';

/**
 * Root of the API process. The only process with MongoDB access; it
 * produces jobs but never consumes them (no processors are provided here).
 */
@Module({
  imports: [
    // core infrastructure
    AppConfigModule.forRoot('api'),
    LoggingModule,
    DatabaseModule,
    RedisModule,
    QueueModule.forRoot('producer'),
    StorageModule,
    CoreAuthModule,
    HealthModule,

    // features
    NotesModule,
  ],
})
export class AppModule {}
