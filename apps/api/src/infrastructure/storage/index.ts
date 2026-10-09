import { createHmac } from 'node:crypto';
import type { Router } from 'express';
import { createFileStorage, storageConfigFromEnv, type FileStorage } from './file-storage';
import { createLocalStorage } from './local-storage';
import { createS3ObjectInspector, type ObjectInspector } from './object-inspector';
import { createS3ObjectReader, type ObjectReader } from './object-reader';
import { createS3StorageProvider } from './s3-storage';

/** Everything the app needs from "where files live", whichever driver is configured. */
export interface Storage {
  driver: 's3' | 'local';
  files: FileStorage;
  inspector: ObjectInspector;
  /** Server-side reads (for the face provider). */
  reader: ObjectReader;
  /** Only the local driver has one: it serves the signed links itself. */
  localRouter?: Router;
}

interface StorageEnv {
  JWT_SECRET: string;
  STORAGE_DRIVER?: 's3' | 'local';
  STORAGE_LOCAL_DIR?: string;
  STORAGE_LOCAL_PUBLIC_URL?: string;
  STORAGE_ENDPOINT?: string;
  STORAGE_REGION: string;
  STORAGE_ACCESS_KEY?: string;
  STORAGE_SECRET_KEY?: string;
  STORAGE_BUCKET?: string;
  STORAGE_FORCE_PATH_STYLE: boolean;
}

/**
 * Chooses the storage driver from configuration, so moving to another provider is a settings change, not a code change:
 *   STORAGE_DRIVER=s3     any S3-compatible service (set STORAGE_ENDPOINT, REGION, ACCESS_KEY, SECRET_KEY, BUCKET)
 *   STORAGE_DRIVER=local  a folder on this machine (development only; env validation refuses it in production)
 *   unset                 s3 if the STORAGE_* group is complete, otherwise null (uploads are switched off)
 */
export function createStorageFromEnv(env: StorageEnv): Storage | null {
  const driver = env.STORAGE_DRIVER ?? (storageConfigFromEnv(env) ? 's3' : null);

  if (driver === 'local') {
    const local = createLocalStorage({
      dir: env.STORAGE_LOCAL_DIR ?? '.local-storage',
      publicUrl: env.STORAGE_LOCAL_PUBLIC_URL ?? '',
      // Derived from a secret the server already has, so the local driver needs no extra setting.
      secret: createHmac('sha256', env.JWT_SECRET)
        .update('facex-local-storage-links')
        .digest('hex'),
    });
    return {
      driver: 'local',
      files: createFileStorage(local.provider),
      inspector: local.inspector,
      reader: local.reader,
      localRouter: local.router,
    };
  }

  const config = storageConfigFromEnv(env);
  if (driver === 's3' && config) {
    return {
      driver: 's3',
      files: createFileStorage(createS3StorageProvider(config)),
      inspector: createS3ObjectInspector(config),
      reader: createS3ObjectReader(config),
    };
  }
  return null;
}
