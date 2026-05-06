import { Client } from 'minio';
import type { Region } from 'minio';

export interface MinioStorageClientOptions {
  endPoint: string;
  port: number;
  accessKey: string;
  secretKey: string;
  bucket: string;
  useSSL: boolean;
  region?: string;
}

export interface UploadFileParams {
  filePath: string;
  objectKey: string;
  contentType: string;
}

export interface UploadedFileObject {
  bucket: string;
  objectKey: string;
  etag: string;
  versionId: string | null;
}

export class MinioStorageClient {
  readonly bucket: string;

  private readonly client: Client;
  private readonly region?: Region;
  private bucketReady = false;

  constructor(opts: MinioStorageClientOptions) {
    this.bucket = opts.bucket;
    this.region = opts.region as Region | undefined;
    this.client = new Client({
      endPoint: opts.endPoint,
      port: opts.port,
      accessKey: opts.accessKey,
      secretKey: opts.secretKey,
      useSSL: opts.useSSL,
      region: this.region,
    });
  }

  buildKnowledgeObjectKey(collectionId: string, fileId: string, filename: string): string {
    const safeCollectionId = sanitizeObjectKeySegment(collectionId);
    const safeFilename = sanitizeFilename(filename);
    return `knowledge/${safeCollectionId}/${fileId}/${safeFilename}`;
  }

  async uploadFile(params: UploadFileParams): Promise<UploadedFileObject> {
    await this.ensureBucket();

    try {
      const result = await this.client.fPutObject(this.bucket, params.objectKey, params.filePath, {
        'Content-Type': params.contentType,
      });

      return {
        bucket: this.bucket,
        objectKey: params.objectKey,
        etag: result.etag,
        versionId: result.versionId,
      };
    } catch (err) {
      throw new StorageError(`minio upload failed: ${(err as Error).message}`, err);
    }
  }

  private async ensureBucket(): Promise<void> {
    if (this.bucketReady) return;

    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket, this.region);
      }
      this.bucketReady = true;
    } catch (err) {
      throw new StorageError(`minio bucket check failed: ${(err as Error).message}`, err);
    }
  }
}

export class StorageError extends Error {
  readonly payload: unknown;

  constructor(message: string, payload: unknown) {
    super(message);
    this.name = 'StorageError';
    this.payload = payload;
  }
}

function sanitizeObjectKeySegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '_') || 'default';
}

function sanitizeFilename(filename: string): string {
  const normalized = filename.trim().split(/[\\/]/).pop() ?? 'file';
  return normalized.replace(/[^a-zA-Z0-9._-]+/g, '_') || 'file';
}
