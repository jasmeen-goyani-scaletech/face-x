import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { StorageConfig } from './storage-provider';

/**
 * Server-side read of one stored object into memory, for the few cases where the server itself must process the
 * file (today: handing a registration photo to the face provider). A separate capability: StorageProvider and
 * FileStorage are unchanged, and the bytes are never written anywhere else.
 */
export type ReadObject =
  | { exists: false }
  | { exists: true; tooLarge: true }
  | { exists: true; tooLarge: false; bytes: Uint8Array };

export interface ObjectReader {
  /** Reads the object if it is at most `maxBytes`. Throws on provider failure. */
  read(key: string, options: { maxBytes: number }): Promise<ReadObject>;
}

const isNotFound = (err: unknown) => {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
};

export function createS3ObjectReader(config: StorageConfig): ObjectReader {
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
  });

  return {
    async read(key, { maxBytes }) {
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
        if ((head.ContentLength ?? 0) > maxBytes) return { exists: true, tooLarge: true };
        const object = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
        const bytes = object.Body ? await object.Body.transformToByteArray() : new Uint8Array();
        return bytes.length > maxBytes
          ? { exists: true, tooLarge: true }
          : { exists: true, tooLarge: false, bytes };
      } catch (err) {
        if (isNotFound(err)) return { exists: false };
        throw err;
      }
    },
  };
}
