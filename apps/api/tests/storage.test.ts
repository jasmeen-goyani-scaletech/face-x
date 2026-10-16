import { describe, expect, it } from 'vitest';
import {
  DOWNLOAD_URL_TTL_SECONDS,
  UPLOAD_URL_TTL_SECONDS,
  createFileStorage,
  storageConfigFromEnv,
} from '../src/infrastructure/storage/file-storage';
import { createS3StorageProvider } from '../src/infrastructure/storage/s3-storage';
import type { StorageProvider } from '../src/infrastructure/storage/storage-provider';

/**
 * Authorization/policy tests use a recording fake provider. The S3 presigning tests compute real signed
 * URLs locally with fake credentials: they check the URL's shape and that no secret leaks, but they do NOT
 * talk to any bucket, so uploads/downloads against a real S3-compatible service remain UNVERIFIED.
 */
function fakeProvider() {
  const calls: { op: string; key: string; options: unknown }[] = [];
  const provider: StorageProvider = {
    createUploadUrl: async (key, options) => {
      calls.push({ op: 'upload', key, options });
      return {
        url: `https://signed.example/${key}?sig=x`,
        method: 'PUT',
        headers: { 'Content-Type': options.contentType },
        expiresAt: new Date(),
      };
    },
    createDownloadUrl: async (key, options) => {
      calls.push({ op: 'download', key, options });
      return { url: `https://signed.example/${key}?sig=y`, expiresAt: new Date() };
    },
    deleteObject: async (key) => {
      calls.push({ op: 'delete', key, options: undefined });
    },
  };
  return { provider, calls };
}

const REG_A = '11111111-1111-4111-8111-111111111111';
const REG_B = '22222222-2222-4222-8222-222222222222';

describe('upload authorization / policy', () => {
  it('generates the object key on the server, scoped to area and registration', async () => {
    const { provider, calls } = fakeProvider();
    const upload = await createFileStorage(provider).issueUpload({
      area: 'registration-documents',
      registrationId: REG_A,
      mimeType: 'application/pdf',
      sizeBytes: 1000,
    });
    expect(upload.key).toMatch(new RegExp(`^registration-documents/${REG_A}/[0-9a-f-]{36}$`));
    expect(calls[0]).toMatchObject({ op: 'upload', key: upload.key });
    expect(upload.method).toBe('PUT');
  });

  it('never reuses keys', async () => {
    const storage = createFileStorage(fakeProvider().provider);
    const input = {
      area: 'player-images',
      registrationId: REG_A,
      mimeType: 'image/png',
      sizeBytes: 10,
    } as const;
    expect((await storage.issueUpload(input)).key).not.toEqual(
      (await storage.issueUpload(input)).key,
    );
  });

  it('rejects disallowed MIME types per area', async () => {
    const storage = createFileStorage(fakeProvider().provider);
    for (const [area, mimeType] of [
      ['registration-documents', 'text/html'],
      ['registration-documents', 'application/x-msdownload'],
      ['player-images', 'application/pdf'],
      ['player-images', 'image/svg+xml'],
    ] as const) {
      await expect(
        storage.issueUpload({ area, registrationId: REG_A, mimeType, sizeBytes: 10 }),
      ).rejects.toMatchObject({ code: 'FILE_TYPE_NOT_ALLOWED', status: 400 });
    }
  });

  it('rejects oversize, zero, negative and non-integer sizes', async () => {
    const storage = createFileStorage(fakeProvider().provider);
    for (const sizeBytes of [0, -1, 1.5, Number.NaN, 11 * 1024 * 1024]) {
      await expect(
        storage.issueUpload({
          area: 'registration-documents',
          registrationId: REG_A,
          mimeType: 'application/pdf',
          sizeBytes,
        }),
      ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    }
    await expect(
      storage.issueUpload({
        area: 'player-images',
        registrationId: REG_A,
        mimeType: 'image/png',
        sizeBytes: 6 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
  });

  it('rejects a registration id that could smuggle path segments', async () => {
    const storage = createFileStorage(fakeProvider().provider);
    for (const registrationId of ['../other', 'a/b', '', REG_A + '/../x']) {
      await expect(
        storage.issueUpload({
          area: 'registration-documents',
          registrationId,
          mimeType: 'application/pdf',
          sizeBytes: 10,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_REGISTRATION_ID' });
    }
  });

  it('keeps signed-URL lifetimes short', () => {
    expect(UPLOAD_URL_TTL_SECONDS).toBeLessThanOrEqual(15 * 60);
    expect(DOWNLOAD_URL_TTL_SECONDS).toBeLessThanOrEqual(15 * 60);
  });
});

describe('download / delete authorization', () => {
  const key = `registration-documents/${REG_A}/33333333-3333-4333-8333-333333333333`;

  it('issues a URL for a key that belongs to the registration', async () => {
    const { provider, calls } = fakeProvider();
    const download = await createFileStorage(provider).issueDownload({
      key,
      registrationId: REG_A,
      downloadFileName: 'birth cert.pdf',
    });
    expect(download.url).toContain(key);
    expect(calls[0]).toMatchObject({ op: 'download', key });
  });

  it("refuses another registration's file, even with a valid-looking key", async () => {
    const { provider, calls } = fakeProvider();
    const storage = createFileStorage(provider);
    await expect(storage.issueDownload({ key, registrationId: REG_B })).rejects.toMatchObject({
      status: 403,
      code: 'STORAGE_KEY_DENIED',
    });
    await expect(storage.remove({ key, registrationId: REG_B })).rejects.toMatchObject({
      status: 403,
    });
    expect(calls).toEqual([]); // the provider was never asked
  });

  it('refuses malformed, traversal and foreign-area keys', async () => {
    const { provider, calls } = fakeProvider();
    const storage = createFileStorage(provider);
    for (const bad of [
      '',
      'x',
      `../${key}`,
      `${key}/../../secret`,
      `other-area/${REG_A}/33333333-3333-4333-8333-333333333333`,
      `registration-documents/${REG_A}/not-a-uuid`,
      `registration-documents/${REG_A}`,
      `/${key}`,
      `${key}?x=1`,
    ]) {
      await expect(
        storage.issueDownload({ key: bad, registrationId: REG_A }),
      ).rejects.toMatchObject({ code: 'STORAGE_KEY_DENIED' });
    }
    expect(calls).toEqual([]);
  });
});

describe('S3 presigning (local computation only; no bucket contacted)', () => {
  const provider = createS3StorageProvider({
    endpoint: 'https://storage.example.com',
    region: 'auto',
    accessKey: 'AKIAEXAMPLEKEY',
    secretKey: 'super-secret-storage-key',
    bucket: 'facex-private',
    forcePathStyle: true,
  });
  const key = `registration-documents/${REG_A}/33333333-3333-4333-8333-333333333333`;

  it('presigns an upload bound to type and size, with a short expiry and no secret in the URL', async () => {
    const up = await provider.createUploadUrl(key, {
      contentType: 'application/pdf',
      contentLength: 1234,
      expiresInSeconds: 600,
    });
    const url = new URL(up.url);
    expect(url.host).toBe('storage.example.com');
    expect(url.pathname).toBe(`/facex-private/${key}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get('X-Amz-SignedHeaders') ?? '').toContain('content-type');
    expect(up.url).not.toContain('super-secret-storage-key');
    expect(up.headers).toEqual({ 'Content-Type': 'application/pdf' });
  });

  it('presigns a download as an attachment and never exposes credentials', async () => {
    const down = await provider.createDownloadUrl(key, {
      expiresInSeconds: 300,
      downloadFileName: 'a b.pdf',
    });
    const url = new URL(down.url);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('response-content-disposition')).toContain('attachment');
    expect(JSON.stringify(down)).not.toContain('super-secret-storage-key');
  });
});

describe('storage config', () => {
  it('is null (storage disabled) unless the credential group is complete', () => {
    const base = { STORAGE_REGION: 'auto', STORAGE_FORCE_PATH_STYLE: false };
    expect(storageConfigFromEnv(base)).toBeNull();
    expect(
      storageConfigFromEnv({
        ...base,
        STORAGE_ACCESS_KEY: 'a',
        STORAGE_SECRET_KEY: 's',
        STORAGE_BUCKET: 'b',
      }),
    ).toMatchObject({ bucket: 'b' });
  });
});
