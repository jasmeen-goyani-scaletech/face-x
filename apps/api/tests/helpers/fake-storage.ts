import { createFileStorage } from '../../src/infrastructure/storage/file-storage';
import type { ObjectInspector } from '../../src/infrastructure/storage/object-inspector';
import type { ObjectReader } from '../../src/infrastructure/storage/object-reader';
import type { StorageProvider } from '../../src/infrastructure/storage/storage-provider';

/**
 * In-memory stand-in for private object storage: a recording StorageProvider (what URLs were signed, with what
 * limits), an object store the test can "upload" into, and an inspector that reads it back. It proves OUR
 * logic; it is not a real bucket (real S3 behavior is unverified).
 */
export interface SignedCall {
  op: 'upload' | 'download' | 'delete';
  key: string;
  expiresInSeconds?: number;
  contentType?: string;
  contentLength?: number;
  url?: string;
}

export function createFakeStorage() {
  const objects = new Map<string, Uint8Array>();
  const calls: SignedCall[] = [];
  const failures = { upload: false, download: false, inspect: false, delete: false };

  const provider: StorageProvider = {
    async createUploadUrl(key, options) {
      if (failures.upload) throw new Error('storage exploded: AKIAFAKESECRETKEY');
      const url = `https://storage.test/${key}?X-Signature=${'a'.repeat(32)}&X-Expires=${options.expiresInSeconds}`;
      calls.push({ op: 'upload', key, url, ...options });
      return {
        url,
        method: 'PUT',
        headers: { 'Content-Type': options.contentType },
        expiresAt: new Date(Date.now() + options.expiresInSeconds * 1000),
      };
    },
    async createDownloadUrl(key, options) {
      if (failures.download) throw new Error('storage exploded');
      const url = `https://storage.test/${key}?X-Signature=${'b'.repeat(32)}&X-Expires=${options.expiresInSeconds}`;
      calls.push({ op: 'download', key, url, expiresInSeconds: options.expiresInSeconds });
      return { url, expiresAt: new Date(Date.now() + options.expiresInSeconds * 1000) };
    },
    async deleteObject(key) {
      if (failures.delete) throw new Error('delete failed');
      calls.push({ op: 'delete', key });
      objects.delete(key);
    },
  };

  const inspector: ObjectInspector = {
    async inspect(key) {
      if (failures.inspect) throw new Error('storage exploded');
      const bytes = objects.get(key);
      return bytes
        ? { exists: true, sizeBytes: bytes.length, header: bytes.slice(0, 12) }
        : { exists: false };
    },
  };

  return {
    provider,
    files: createFileStorage(provider),
    inspector,
    /** Server-side read of a whole object (used to hand a photo to the face provider). */
    reader: {
      async read(key: string, options: { maxBytes: number }) {
        if (failures.inspect) throw new Error('storage exploded');
        const bytes = objects.get(key);
        if (!bytes) return { exists: false as const };
        return bytes.length > options.maxBytes
          ? { exists: true as const, tooLarge: true as const }
          : { exists: true as const, tooLarge: false as const, bytes };
      },
    } satisfies ObjectReader,
    objects,
    calls,
    failures,
    /** Simulates the browser PUT-ing the file to the signed URL. */
    put: (key: string, bytes: Uint8Array) => objects.set(key, bytes),
    uploadsFor: (registrationId: string) =>
      calls.filter((c) => c.op === 'upload' && c.key.split('/')[1] === registrationId),
  };
}

export type FakeStorage = ReturnType<typeof createFakeStorage>;

const pad = (head: number[], total: number) =>
  Uint8Array.from([...head, ...new Array(Math.max(0, total - head.length)).fill(0x20)]);

/** Real file signatures, padded to a given size, so the content check can be exercised. */
export const fileBytes = {
  pdf: (size = 2048) => pad([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34], size),
  png: (size = 2048) => pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], size),
  jpeg: (size = 2048) => pad([0xff, 0xd8, 0xff, 0xe0], size),
  webp: (size = 2048) => pad([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], size),
  html: (size = 2048) => pad([...Buffer.from('<html><script>alert(1)</script>')], size),
  exe: (size = 2048) => pad([0x4d, 0x5a, 0x90, 0x00], size),
  /** A ZIP local-file header, as every DOCX starts. */
  docx: (size = 2048) => pad([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00], size),
  /** A legacy Word .doc (OLE compound file). */
  doc: (size = 2048) => pad([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], size),
};
