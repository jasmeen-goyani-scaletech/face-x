import { mkdtempSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { EnvValidationError, parseEnv } from '../src/config/env';
import type { Database } from '../src/infrastructure/database/database';
import { createFileStorage } from '../src/infrastructure/storage/file-storage';
import { createStorageFromEnv } from '../src/infrastructure/storage';
import { createLocalStorage } from '../src/infrastructure/storage/local-storage';
import { createS3StorageProvider } from '../src/infrastructure/storage/s3-storage';
import { as, childBody, createChild, createEvent, createOrg, createTeam } from './helpers/fixtures';
import { fileBytes } from './helpers/fake-storage';
import { buildApi, createUser, openTestDb, silentLogger } from './helpers/test-app';
import { testEnv } from './helpers/test-env';

/**
 * The development-only local storage driver, exercised through the real documents API and a real folder on disk: the same
 * signed-URL flow a bucket gives (request link -> browser PUT -> server verifies -> admin download link).
 */
let db: Database;
let dir: string;
let app: ReturnType<typeof buildApi>;
let local: ReturnType<typeof createLocalStorage>;
let orgA: string;
let eventA: string;
let teamA: string;
let adminA: string;
const SECRET = 'local-storage-test-secret-0123456789';

const R = '/api/v1/registrations';
const D = '/api/v1/documents';

beforeAll(async () => {
  db = openTestDb();
  dir = mkdtempSync(join(tmpdir(), 'facex-local-storage-'));
  local = createLocalStorage({ dir, publicUrl: '', secret: SECRET });
  app = buildApi(db, {
    storage: {
      files: createFileStorage(local.provider),
      inspector: local.inspector,
      localRouter: local.router,
    },
  });
  orgA = await createOrg(db);
  eventA = await createEvent(db, orgA);
  teamA = await createTeam(db, eventA);
  adminA = (await createUser(db, { roles: ['ADMIN'], organizationId: orgA })).id;
});
afterAll(async () => {
  await db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function family() {
  const parent = await createUser(db, { roles: ['PARENT'] });
  const playerId = await createChild(app, parent.id, childBody());
  const reg = await as(app, parent.id).post(R, { eventId: eventA, playerId, teamId: teamA });
  return { parent, regId: reg.body.data.id as string };
}

const pdf = (size = 2048) => Buffer.from(fileBytes.pdf(size));
const requestUpload = (f: Awaited<ReturnType<typeof family>>, body: Record<string, unknown> = {}) =>
  as(app, f.parent.id).post(`${R}/${f.regId}/documents/upload-url`, {
    documentType: 'BIRTH_CERTIFICATE',
    fileName: 'birth certificate.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 2048,
    ...body,
  });
const put = (url: string, bytes: Buffer, contentType = 'application/pdf') =>
  request(app).put(url).set('Content-Type', contentType).send(bytes);

describe('the whole upload flow through the local driver', () => {
  it('request link -> PUT -> complete -> submit -> admin download, with the file really on disk', async () => {
    const f = await family();
    const up = await requestUpload(f);
    expect(up.status).toBe(201);
    const { document, upload } = up.body.data;
    expect(upload.method).toBe('PUT');
    expect(upload.url).toMatch(
      new RegExp(`^/api/v1/dev-storage/registration-documents/${f.regId}/[0-9a-f-]{36}\\?`),
    );
    expect(upload.headers).toEqual({ 'Content-Type': 'application/pdf' });
    expect(JSON.stringify(up.body)).not.toContain(dir); // no server path ever reaches a client

    const bytes = pdf();
    expect((await put(upload.url, bytes)).status).toBe(200);
    const stored = readdirSync(join(dir, 'registration-documents', f.regId));
    expect(stored).toHaveLength(1);
    expect(readFileSync(join(dir, 'registration-documents', f.regId, stored[0]!))).toEqual(bytes);

    const done = await as(app, f.parent.id).post(`${D}/${document.id}/complete`);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.data.state).toBe('UPLOADED');
    expect((await as(app, f.parent.id).post(`${D}/${document.id}/submit`)).status).toBe(200);

    const dl = await as(app, adminA).get(`${D}/${document.id}/download-url`);
    expect(dl.status).toBe(200);
    const got = await request(app).get(dl.body.data.url);
    expect(got.status).toBe(200);
    expect(got.headers['content-type']).toBe('application/pdf');
    expect(got.headers['content-disposition']).toContain(
      "filename*=UTF-8''birth%20certificate.pdf",
    );
    expect(got.headers['cache-control']).toBe('private, no-store');
    expect(Buffer.from(got.body)).toEqual(bytes);
  });

  it('a file whose bytes are not what it claims is refused at the server check, whatever the link allowed', async () => {
    const f = await family();
    const { upload, document } = (await requestUpload(f)).body.data;
    expect((await put(upload.url, Buffer.from(fileBytes.html(2048)))).status).toBe(200); // the link only binds type + size
    const done = await as(app, f.parent.id).post(`${D}/${document.id}/complete`);
    expect(done.status).toBe(422);
    expect(JSON.stringify(done.body)).toMatch(/do not match/);
  });

  it('completing before anything was uploaded is refused', async () => {
    const f = await family();
    const { document } = (await requestUpload(f)).body.data;
    const done = await as(app, f.parent.id).post(`${D}/${document.id}/complete`);
    expect(done.status).toBe(409);
    expect(done.body.error.code).toBe('UPLOAD_NOT_COMPLETE');
  });
});

describe('signed links are the only credential, and they bind exactly what was signed', () => {
  async function link() {
    const f = await family();
    const { upload } = (await requestUpload(f)).body.data;
    return { f, url: upload.url as string };
  }
  const deny = (res: request.Response, code = 'STORAGE_LINK_INVALID') => {
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(code);
  };

  it('rejects a tampered signature, a different content type, a different size and no query at all', async () => {
    const { url } = await link();
    const base = url.split('?')[0]!;
    deny(await put(url.replace(/sig=[^&]+/, 'sig=AAAAAAAAAAAAAAAAAAAA'), pdf()));
    deny(await put(url, pdf(), 'image/png'));
    deny(await put(url, pdf(4096)));
    deny(await put(base, pdf()));
    deny(await put(`${base}?exp=9999999999&sig=AAAAAAAAAAAAAAAAAAAA`, pdf()));
  });

  it('rejects an expired link', async () => {
    const f = await family();
    const key = `registration-documents/${f.regId}/${'1'.repeat(8)}-1111-4111-8111-${'1'.repeat(12)}`;
    const expired = await local.provider.createUploadUrl(key, {
      contentType: 'application/pdf',
      contentLength: 2048,
      expiresInSeconds: -30,
    });
    deny(await put(expired.url, pdf()), 'STORAGE_LINK_EXPIRED');
    expect(existsSync(join(dir, key))).toBe(false);
  });

  it('a download link cannot upload and an upload link cannot download (the method is part of the signature)', async () => {
    const { f, url } = await link();
    // upload link used for GET
    deny(await request(app).get(url));
    // a real download link used for PUT
    const key = url.split('?')[0]!.replace('/api/v1/dev-storage/', '');
    const dl = await local.provider.createDownloadUrl(key, { expiresInSeconds: 60 });
    deny(await put(dl.url, pdf()));
    expect(f.regId).toBeTruthy();
  });

  it('refuses malformed and traversal paths and never writes outside its folder', async () => {
    const outside = join(dir, '..', 'facex-escape-test.txt');
    for (const path of [
      '/api/v1/dev-storage/registration-documents/..%2F..%2Ffacex-escape-test.txt/x',
      '/api/v1/dev-storage/registration-documents/not-a-uuid/not-a-uuid?exp=9999999999&sig=AAAAAAAAAAAAAAAAAAAA',
      '/api/v1/dev-storage/other-area/00000000-0000-4000-8000-000000000000/00000000-0000-4000-8000-000000000000?exp=9999999999&sig=AAAAAAAAAAAAAAAAAAAA',
    ]) {
      const res = await put(path, pdf());
      expect([403, 404]).toContain(res.status);
    }
    expect(existsSync(outside)).toBe(false);
  });

  it('a link for one registration cannot be reused for a path under another (the key is signed)', async () => {
    const { url } = await link();
    const other = url.replace(
      /registration-documents\/[0-9a-f-]{36}\//,
      'registration-documents/00000000-0000-4000-8000-000000000000/',
    );
    deny(await put(other, pdf()));
  });
});

describe('inspector and reader', () => {
  it('report presence, size and header bytes, and honour the size limit', async () => {
    const f = await family();
    const { upload, document } = (await requestUpload(f, { sizeBytes: 3000 })).body.data;
    const key = (
      await db.query<{ storage_key: string }>(
        'select storage_key from public.documents where id = $1',
        [document.id],
      )
    ).rows[0]!.storage_key;
    expect(await local.inspector.inspect(key)).toEqual({ exists: false });
    expect(await local.reader.read(key, { maxBytes: 10_000 })).toEqual({ exists: false });
    await put(upload.url, pdf(3000));
    const seen = await local.inspector.inspect(key);
    expect(seen).toMatchObject({ exists: true, sizeBytes: 3000 });
    expect(Buffer.from((seen as { header: Uint8Array }).header).toString('latin1', 0, 5)).toBe(
      '%PDF-',
    );
    expect(await local.reader.read(key, { maxBytes: 100 })).toEqual({
      exists: true,
      tooLarge: true,
    });
    const full = await local.reader.read(key, { maxBytes: 10_000 });
    expect(full).toMatchObject({ exists: true, tooLarge: false });
    await local.provider.deleteObject(key);
    expect(await local.inspector.inspect(key)).toEqual({ exists: false });
  });

  it('refuse a key that is not one of ours', async () => {
    await expect(local.inspector.inspect('../../etc/passwd')).rejects.toMatchObject({
      code: 'STORAGE_OBJECT_NOT_FOUND',
    });
    await expect(
      local.reader.read('registration-documents/x/y', { maxBytes: 1 }),
    ).rejects.toMatchObject({ code: 'STORAGE_OBJECT_NOT_FOUND' });
  });
});

describe('choosing the driver from configuration', () => {
  const base = {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/facex',
    JWT_SECRET: 'a'.repeat(40),
    REFRESH_TOKEN_SECRET: 'b'.repeat(40),
    FRONTEND_URL: 'http://localhost:3000',
  };
  const s3 = { STORAGE_ACCESS_KEY: 'k', STORAGE_SECRET_KEY: 's', STORAGE_BUCKET: 'b' };

  it('local is allowed in development and refused in production (files must not sit on an app server disk by accident)', () => {
    expect(parseEnv({ ...base, STORAGE_DRIVER: 'local' }).STORAGE_DRIVER).toBe('local');
    expect(() => parseEnv({ ...base, NODE_ENV: 'production', STORAGE_DRIVER: 'local' })).toThrow(
      EnvValidationError,
    );
    expect(() => parseEnv({ ...base, NODE_ENV: 'production', STORAGE_DRIVER: 'local' })).toThrow(
      /development only/,
    );
  });

  it('s3 needs its credentials, and a bad driver name is rejected', () => {
    expect(() => parseEnv({ ...base, STORAGE_DRIVER: 's3' })).toThrow(/STORAGE_BUCKET/);
    expect(parseEnv({ ...base, STORAGE_DRIVER: 's3', ...s3 }).STORAGE_DRIVER).toBe('s3');
    expect(() => parseEnv({ ...base, STORAGE_DRIVER: 'ftp' })).toThrow(EnvValidationError);
    expect(parseEnv({ ...base, STORAGE_DRIVER: '' }).STORAGE_DRIVER).toBeUndefined();
  });

  it('picks the driver: s3 when its settings are complete, local when asked, nothing otherwise', () => {
    const e = (over: Record<string, unknown>) => parseEnv({ ...base, ...over });
    expect(createStorageFromEnv(e({}))).toBeNull();
    expect(createStorageFromEnv(e(s3))?.driver).toBe('s3');
    const loc = createStorageFromEnv(e({ STORAGE_DRIVER: 'local', STORAGE_LOCAL_DIR: dir }));
    expect(loc?.driver).toBe('local');
    expect(loc?.localRouter).toBeDefined();
    expect(createStorageFromEnv(e({ ...s3, STORAGE_DRIVER: 'local' }))?.driver).toBe('local'); // explicit choice wins
  });
});

describe('TRUST_PROXY_HOPS', () => {
  const make = (over: Record<string, unknown>) =>
    createApp({
      env: { ...testEnv, ...over } as typeof testEnv,
      logger: silentLogger(),
      db,
      globalRequestsPerMinute: 1_000_000,
    });

  it('defaults to trusting no proxy outside production and one in production', () => {
    expect(make({}).get('trust proxy')).toBe(false);
    expect(make({ NODE_ENV: 'production' }).get('trust proxy')).toBe(1);
  });

  it('can be set explicitly, so the rate limits see the real client address', async () => {
    const app2 = make({ TRUST_PROXY_HOPS: 2 });
    expect(app2.get('trust proxy')).toBe(2);
    const direct = make({ TRUST_PROXY_HOPS: 0, NODE_ENV: 'production' });
    expect(direct.get('trust proxy')).toBe(false);
  });
});

describe('inline preview links (the admin preview must show a PDF, not force a download)', () => {
  const keyFor = (regId: string) =>
    `registration-documents/${regId}/22222222-2222-4222-8222-222222222222`;

  it('local driver: default is attachment, inline is inline, and the signature binds the choice', async () => {
    const f = await family();
    const key = keyFor(f.regId);
    const { upload } = (await requestUpload(f)).body.data;
    // put real bytes at the key we will sign for, using a link the driver issued for exactly that key
    const put2 = await local.provider.createUploadUrl(key, {
      contentType: 'application/pdf',
      contentLength: 2048,
      expiresInSeconds: 60,
    });
    expect((await put(put2.url, pdf())).status).toBe(200);
    expect(upload.url).toBeTruthy();

    const attach = await local.provider.createDownloadUrl(key, {
      expiresInSeconds: 60,
      downloadFileName: 'a b.pdf',
    });
    const inline = await local.provider.createDownloadUrl(key, {
      expiresInSeconds: 60,
      downloadFileName: 'a b.pdf',
      inline: true,
    });
    expect(attach.url).not.toContain('inline=');
    expect(inline.url).toContain('inline=1');

    const a = await request(app).get(attach.url);
    expect(a.status).toBe(200);
    expect(a.headers['content-disposition']).toBe("attachment; filename*=UTF-8''a%20b.pdf");
    const i = await request(app).get(inline.url);
    expect(i.status).toBe(200);
    expect(i.headers['content-disposition']).toBe("inline; filename*=UTF-8''a%20b.pdf");
    expect(i.headers['content-type']).toBe('application/pdf');
    expect(i.headers['x-content-type-options']).toBe('nosniff');

    // Switching the choice by editing the URL breaks the signature.
    expect((await request(app).get(attach.url + '&inline=1')).status).toBe(403);
    expect(
      (await request(app).get(inline.url.replace('&inline=1', '').replace('inline=1&', ''))).status,
    ).toBe(403);
  });

  it('GET /documents/:id/download-url?inline=true issues an inline link; the default and bad values behave', async () => {
    const f = await family();
    const { upload, document } = (await requestUpload(f)).body.data;
    expect((await put(upload.url, pdf())).status).toBe(200);
    expect((await as(app, f.parent.id).post(`${D}/${document.id}/complete`)).status).toBe(200);

    const plain = await as(app, f.parent.id).get(`${D}/${document.id}/download-url`);
    expect(plain.body.data.url).not.toContain('inline=');
    const inline = await as(app, f.parent.id).get(`${D}/${document.id}/download-url?inline=true`);
    expect(inline.status).toBe(200);
    expect(inline.body.data.url).toContain('inline=1');
    expect((await request(app).get(inline.body.data.url)).headers['content-disposition']).toMatch(
      /^inline;/,
    );
    expect(
      (await as(app, f.parent.id).get(`${D}/${document.id}/download-url?inline=false`)).body.data
        .url,
    ).not.toContain('inline=');
    expect(
      (await as(app, f.parent.id).get(`${D}/${document.id}/download-url?inline=maybe`)).status,
    ).toBe(422);
    expect((await as(app, f.parent.id).get(`${D}/${document.id}/download-url?x=1`)).status).toBe(
      422,
    );
  });

  it('the S3 provider sets the matching response-content-disposition on its presigned link', async () => {
    const s3 = createS3StorageProvider({
      endpoint: 'https://objects.example.test',
      region: 'us-east-1',
      accessKey: 'k',
      secretKey: 's',
      bucket: 'b',
      forcePathStyle: true,
    });
    const key = keyFor('11111111-1111-4111-8111-111111111111');
    const disp = async (inline?: boolean) =>
      new URL(
        (
          await s3.createDownloadUrl(key, {
            expiresInSeconds: 60,
            downloadFileName: 'a b.pdf',
            inline,
          })
        ).url,
      ).searchParams.get('response-content-disposition');
    expect(await disp()).toBe("attachment; filename*=UTF-8''a%20b.pdf");
    expect(await disp(false)).toBe("attachment; filename*=UTF-8''a%20b.pdf");
    expect(await disp(true)).toBe("inline; filename*=UTF-8''a%20b.pdf");
  });
});
