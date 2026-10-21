import { S3Client } from '@aws-sdk/client-s3';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SharedEnvironment } from '../config/env.validation';
import { S3_CLIENT, StorageService } from './storage.service';

@Global()
@Module({
  providers: [
    {
      provide: S3_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<SharedEnvironment, true>) =>
        new S3Client({
          region: config.get('STORAGE_REGION', { infer: true }),
          endpoint:
            config.get('STORAGE_ENDPOINT', { infer: true }) || undefined,
          forcePathStyle: config.get('STORAGE_FORCE_PATH_STYLE', {
            infer: true,
          }),
          credentials: {
            accessKeyId: config.get('STORAGE_ACCESS_KEY_ID', { infer: true }),
            secretAccessKey: config.get('STORAGE_SECRET_ACCESS_KEY', {
              infer: true,
            }),
          },
          maxAttempts: 3,
        }),
    },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
