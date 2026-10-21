import {
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SharedEnvironment } from '../config/env.validation';

export const S3_CLIENT = Symbol('S3_CLIENT');

export interface PutObjectInput {
  key: string;
  body: string | Uint8Array | Buffer;
  contentType: string;
}

export type PutIfAbsentResult = 'created' | 'exists';

/**
 * Object storage on any S3-compatible provider (AWS S3, Cloudflare R2,
 * MinIO), selected purely by configuration.
 */
@Injectable()
export class StorageService implements OnModuleDestroy {
  private readonly logger = new Logger('storage');
  private readonly bucket: string;
  private readonly presignTtl: number;

  constructor(
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    config: ConfigService<SharedEnvironment, true>,
  ) {
    this.bucket = config.get('STORAGE_BUCKET', { infer: true });
    this.presignTtl = config.get('STORAGE_PRESIGN_TTL_SECONDS', {
      infer: true,
    });
  }

  /**
   * Write-once: never replaces an existing object (conditional
   * `If-None-Match: *`, honoured by S3, R2 and MinIO). Use it for immutable
   * artifacts; a retried job that already wrote gets 'exists', not a second
   * write.
   */
  async putIfAbsent(input: PutObjectInput): Promise<PutIfAbsentResult> {
    const startedAt = Date.now();
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          IfNoneMatch: '*',
        }),
      );
      this.logger.log({
        operation: 'storage.putIfAbsent',
        status: 'ok',
        key: input.key,
        result: 'created',
        durationMs: Date.now() - startedAt,
      });
      return 'created';
    } catch (error) {
      // 412: already there. 409: a concurrent conditional write is in flight.
      const status = (error as S3ServiceException)?.$metadata?.httpStatusCode;
      if (status === 412 || status === 409) {
        this.logger.log({
          operation: 'storage.putIfAbsent',
          status: 'ok',
          key: input.key,
          result: 'exists',
          durationMs: Date.now() - startedAt,
        });
        return 'exists';
      }
      throw error;
    }
  }

  /** Short-lived download link; the bucket itself stays private. */
  presignDownload(
    key: string,
    expiresInSeconds = this.presignTtl,
  ): Promise<string> {
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  /** Client uploads directly to storage with this URL and the same Content-Type. */
  presignUpload(
    key: string,
    contentType: string,
    expiresInSeconds = this.presignTtl,
  ): Promise<string> {
    return getSignedUrl(
      this.s3,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
      { expiresIn: expiresInSeconds },
    );
  }

  /** Throws when the bucket is unreachable or credentials are wrong. */
  async ping(): Promise<void> {
    await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  onModuleDestroy(): void {
    this.s3.destroy();
  }
}
