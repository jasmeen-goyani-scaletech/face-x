import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../shared/errors/app-error';
import type { SignedDownload, SignedUpload, StorageProvider } from './storage-provider';

/**
 * Storage areas inside the single private bucket. The area and registration are part of every key, so a
 * key can be checked against the registration a caller is authorized for.
 */
export const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Default and ceiling for DOCUMENT_MAX_BYTES (one limit for every document type). */
export const DEFAULT_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
export const DOCUMENT_MAX_BYTES_CEILING = 10 * 1024 * 1024;

export const STORAGE_AREAS = {
  'registration-documents': {
    // DOCX is text the extractor can read; the legacy binary .doc is not accepted (nothing here can read it).
    allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', DOCX_MIME_TYPE],
    /** The highest DOCUMENT_MAX_BYTES may go; the limit actually applied is set when storage is created. */
    maxBytes: DOCUMENT_MAX_BYTES_CEILING,
  },
  'player-images': {
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    maxBytes: 2 * 1024 * 1024,
  },
} as const;

/** Size limits per area as configured (documents: DOCUMENT_MAX_BYTES). */
export type StorageLimits = Record<StorageArea, number>;

export const storageLimits = (documentMaxBytes = DEFAULT_DOCUMENT_MAX_BYTES): StorageLimits => ({
  'registration-documents': Math.min(documentMaxBytes, DOCUMENT_MAX_BYTES_CEILING),
  'player-images': STORAGE_AREAS['player-images'].maxBytes,
});

export type StorageArea = keyof typeof STORAGE_AREAS;

export const UPLOAD_URL_TTL_SECONDS = 10 * 60;
export const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;
const MAX_URL_TTL_SECONDS = 15 * 60;

const keySchema = z
  .string()
  .regex(
    /^(registration-documents|player-images)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );

export interface IssuedUpload extends SignedUpload {
  /** Store this in documents.storage_key. */
  key: string;
}

export interface FileStorage {
  /**
   * Validates type and size for the area, generates the object key server-side (never from client input)
   * and returns a short-lived upload URL. The caller must already have authorized the user for
   * `registrationId`.
   */
  issueUpload(input: {
    area: StorageArea;
    registrationId: string;
    mimeType: string;
    sizeBytes: number;
  }): Promise<IssuedUpload>;
  /**
   * Short-lived download URL for a stored key. Refuses a key that is malformed or does not belong to
   * `registrationId`, so a caller authorized for one registration cannot fetch another's file.
   */
  issueDownload(input: {
    key: string;
    registrationId: string;
    downloadFileName?: string;
    /** Open in the browser (preview) rather than download. */
    inline?: boolean;
  }): Promise<SignedDownload>;
  remove(input: { key: string; registrationId: string }): Promise<void>;
}

export function createFileStorage(
  provider: StorageProvider,
  limits: StorageLimits = storageLimits(),
): FileStorage {
  const ownedKey = (key: string, registrationId: string): string => {
    const parsed = keySchema.safeParse(key);
    if (!parsed.success || key.split('/')[1] !== registrationId.toLowerCase()) {
      throw AppError.forbidden(
        'This file does not belong to the registration',
        'STORAGE_KEY_DENIED',
      );
    }
    return key;
  };

  return {
    async issueUpload({ area, registrationId, mimeType, sizeBytes }) {
      const policy = STORAGE_AREAS[area];
      if (!z.uuid().safeParse(registrationId).success) {
        throw AppError.badRequest('INVALID_REGISTRATION_ID', 'Invalid registration id');
      }
      if (!(policy.allowedMimeTypes as readonly string[]).includes(mimeType)) {
        throw AppError.badRequest('FILE_TYPE_NOT_ALLOWED', 'This file type is not allowed');
      }
      const maxBytes = limits[area];
      if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > maxBytes) {
        throw AppError.badRequest(
          'FILE_TOO_LARGE',
          `File is too large (limit ${Math.round(maxBytes / 1024)} KB for this file type)`,
        );
      }
      const key = `${area}/${registrationId.toLowerCase()}/${randomUUID()}`;
      const upload = await provider.createUploadUrl(key, {
        contentType: mimeType,
        contentLength: sizeBytes,
        expiresInSeconds: Math.min(UPLOAD_URL_TTL_SECONDS, MAX_URL_TTL_SECONDS),
      });
      return { ...upload, key };
    },

    async issueDownload({ key, registrationId, downloadFileName, inline }) {
      return provider.createDownloadUrl(ownedKey(key, registrationId), {
        expiresInSeconds: Math.min(DOWNLOAD_URL_TTL_SECONDS, MAX_URL_TTL_SECONDS),
        downloadFileName,
        inline,
      });
    },

    async remove({ key, registrationId }) {
      return provider.deleteObject(ownedKey(key, registrationId));
    },
  };
}

/** Returns the storage config when the STORAGE_* group is set, else null. */
export function storageConfigFromEnv(env: {
  STORAGE_ENDPOINT?: string;
  STORAGE_REGION: string;
  STORAGE_ACCESS_KEY?: string;
  STORAGE_SECRET_KEY?: string;
  STORAGE_BUCKET?: string;
  STORAGE_FORCE_PATH_STYLE: boolean;
}) {
  if (!env.STORAGE_ACCESS_KEY || !env.STORAGE_SECRET_KEY || !env.STORAGE_BUCKET) return null;
  return {
    endpoint: env.STORAGE_ENDPOINT,
    region: env.STORAGE_REGION,
    accessKey: env.STORAGE_ACCESS_KEY,
    secretKey: env.STORAGE_SECRET_KEY,
    bucket: env.STORAGE_BUCKET,
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
  };
}
