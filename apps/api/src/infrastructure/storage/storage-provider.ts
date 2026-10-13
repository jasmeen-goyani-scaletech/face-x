/**
 * Provider-independent contract for private object storage. Implemented for S3-compatible services
 * (AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces...). Business code depends on this interface only.
 *
 * Nothing returned from here may contain provider credentials. Presigned URLs carry a signature that
 * expires, which is the intended and only way a browser touches storage.
 */
export interface SignedUpload {
  url: string;
  method: 'PUT';
  /** Headers the client MUST send unchanged, or the signature check fails. */
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface SignedDownload {
  url: string;
  expiresAt: Date;
}

export interface StorageProvider {
  createUploadUrl(
    key: string,
    options: { contentType: string; contentLength: number; expiresInSeconds: number },
  ): Promise<SignedUpload>;
  createDownloadUrl(
    key: string,
    // `inline`: show the file in the browser (a preview) instead of forcing a download. Only ever set for the validated
    // types (PDF, JPEG, PNG, WebP).
    options: { expiresInSeconds: number; downloadFileName?: string; inline?: boolean },
  ): Promise<SignedDownload>;
  deleteObject(key: string): Promise<void>;
}

export interface StorageConfig {
  endpoint?: string;
  region: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  forcePathStyle: boolean;
}
