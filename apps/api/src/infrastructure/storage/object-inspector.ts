import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { SNIFF_BYTES } from './content-sniffing';
import type { StorageConfig } from './storage-provider';

/**
 * Reads back what was actually stored, so an upload can be verified instead of trusted. Kept separate from
 * StorageProvider (which is unchanged) because it is a different capability: the server inspecting an object,
 * not handing the browser a URL.
 */
export type InspectedObject =
  { exists: false } | { exists: true; sizeBytes: number; header: Uint8Array };

export interface ObjectInspector {
  /** Size and first bytes of the object. `exists: false` when there is no such object. Throws on provider failure. */
  inspect(key: string): Promise<InspectedObject>;
}

const isNotFound = (err: unknown) => {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
};

export function createS3ObjectInspector(config: StorageConfig): ObjectInspector {
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
  });

  return {
    async inspect(key) {
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
        const sizeBytes = head.ContentLength ?? 0;
        const first = await client.send(
          new GetObjectCommand({
            Bucket: config.bucket,
            Key: key,
            Range: `bytes=0-${SNIFF_BYTES - 1}`,
          }),
        );
        const header = first.Body ? await first.Body.transformToByteArray() : new Uint8Array();
        return { exists: true, sizeBytes, header };
      } catch (err) {
        if (isNotFound(err)) return { exists: false };
        throw err;
      }
    },
  };
}
