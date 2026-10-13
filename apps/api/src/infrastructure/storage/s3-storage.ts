import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageConfig, StorageProvider } from './storage-provider';

/** S3-compatible implementation. The bucket must be private (no public ACL or bucket policy). */
export function createS3StorageProvider(config: StorageConfig): StorageProvider {
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
  });
  const expiry = (seconds: number) => new Date(Date.now() + seconds * 1000);

  return {
    async createUploadUrl(key, { contentType, contentLength, expiresInSeconds }) {
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          ContentType: contentType,
          ContentLength: contentLength,
        }),
        {
          expiresIn: expiresInSeconds,
          // Bind the signature to the declared type and size so a different file cannot be PUT.
          signableHeaders: new Set(['content-type', 'content-length']),
          unhoistableHeaders: new Set(['content-type']),
        },
      );
      return {
        url,
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        expiresAt: expiry(expiresInSeconds),
      };
    },

    async createDownloadUrl(key, { expiresInSeconds, downloadFileName, inline }) {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: key,
          ResponseContentDisposition: `${inline ? 'inline' : 'attachment'}${
            downloadFileName ? `; filename*=UTF-8''${encodeURIComponent(downloadFileName)}` : ''
          }`,
        }),
        { expiresIn: expiresInSeconds },
      );
      return { url, expiresAt: expiry(expiresInSeconds) };
    },

    async deleteObject(key) {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    },
  };
}
