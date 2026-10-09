import { Writable } from 'node:stream';
import pino from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REDACT_PATHS } from '../src/config/logger';
import type { Database } from '../src/infrastructure/database/database';
import { as, createChild, createEvent, createOrg, createTeam } from './helpers/fixtures';
import { createFakeStorage, fileBytes, type FakeStorage } from './helpers/fake-storage';
import { buildApi, createUser, openTestDb } from './helpers/test-app';

/** Documents against the real Express app and real PostgreSQL, with a recording in-memory object store. */
let db: Database;
let storage: FakeStorage;
let app: ReturnType<typeof buildApi>;
let orgA: string;
let orgB: string;
let eventA: string;
let teamA: string;
let adminA: string;
let adminB: string;

beforeAll(async () => {
  db = openTestDb();
  storage = createFakeStorage();
  app = buildApi(db, { storage });
  orgA = await createOrg(db);
  orgB = await createOrg(db);
  eventA = await createEvent(db, orgA);
  teamA = await createTeam(db, eventA);
  adminA = (await createUser(db, { roles: ['ADMIN'], organizationId: orgA })).id;
  adminB = (await createUser(db, { roles: ['ADMIN'], organizationId: orgB })).id;
});
afterAll(() => db.close());

const R = '/api/v1/registrations';
const D = '/api/v1/documents';

async function family(event = eventA) {
  const parent = await createUser(db, { roles: ['PARENT'] });
  const playerId = await createChild(app, parent.id);
  const res = await as(app, parent.id).post(R, { eventId: event, playerId, teamId: teamA });
  return { parent, playerId, regId: res.body.data.id as string };
}
type Family = Awaited<ReturnType<typeof family>>;

const pdfBody = (over: Record<string, unknown> = {}) => ({
  documentType: 'BIRTH_CERTIFICATE',
  fileName: 'birth certificate.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 2048,
  ...over,
});
const upload = (f: Family, body: Record<string, unknown> = pdfBody()) =>
  as(app, f.parent.id).post(`${R}/${f.regId}/documents/upload-url`, body);
const keyOf = async (documentId: string) =>
  (
    await db.query<{ storage_key: string }>(
      'select storage_key from public.documents where id = $1',
      [documentId],
    )
  ).rows[0]!.storage_key;

/** request -> "browser uploads" -> complete. Returns the document id. */
async function uploaded(f: Family, body: Record<string, unknown> = pdfBody(), bytes?: Uint8Array) {
  const res = await upload(f, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const id = res.body.data.document.id as string;
  storage.put(
    await keyOf(id),
    bytes ?? bytesFor(body.mimeType as string, body.sizeBytes as number),
  );
  const done = await as(app, f.parent.id).post(`${D}/${id}/complete`);
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  return id;
}
async function submitted(f: Family, body?: Record<string, unknown>) {
  const id = await uploaded(f, body);
  expect((await as(app, f.parent.id).post(`${D}/${id}/submit`)).status).toBe(200);
  return id;
}
const bytesFor = (mime: string, size: number) =>
  mime === 'application/pdf'
    ? fileBytes.pdf(size)
    : mime === 'image/jpeg'
      ? fileBytes.jpeg(size)
      : mime === 'image/webp'
        ? fileBytes.webp(size)
        : fileBytes.png(size);
const approve = (admin: string, id: string) =>
  as(app, admin).patch(`${D}/${id}/review`, { decision: 'APPROVED' });
const reject = (admin: string, id: string, over: Record<string, unknown> = {}) =>
  as(app, admin).patch(`${D}/${id}/review`, {
    decision: 'REJECTED',
    reasonCode: 'UNREADABLE',
    reason: 'Too blurry to read.',
    ...over,
  });

describe('requesting an upload (presigned URL)', () => {
  it('creates the document metadata and returns a short-lived signed URL, never a storage key or credentials', async () => {
    const f = await family();
    const res = await upload(f);
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');

    const { document, upload: instructions } = res.body.data;
    expect(document).toMatchObject({
      registrationId: f.regId,
      documentType: 'BIRTH_CERTIFICATE',
      fileName: 'birth certificate.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
      state: 'AWAITING_UPLOAD',
      uploadedAt: null,
      submittedAt: null,
      review: null,
    });
    expect(instructions).toMatchObject({
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
    });
    expect(instructions.url).toMatch(/^https:\/\/storage\.test\//);
    const ttlMs = new Date(instructions.expiresAt).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(0);
    expect(ttlMs).toBeLessThanOrEqual(15 * 60_000);

    const key = await keyOf(document.id);
    expect(key).toMatch(new RegExp(`^registration-documents/${f.regId}/[0-9a-f-]{36}$`));
    // the key is server-side only
    expect(JSON.stringify(document)).not.toContain(key);
    expect(Object.keys(document).sort()).toEqual(
      [
        'createdAt',
        'documentType',
        'fileName',
        'id',
        'mimeType',
        'registrationId',
        'review',
        'sizeBytes',
        'state',
        'submittedAt',
        'updatedAt',
        'uploadedAt',
      ].sort(),
    );
    const lastCall = storage.calls.filter((c) => c.op === 'upload').at(-1)!;
    expect(lastCall).toMatchObject({ key, contentType: 'application/pdf', contentLength: 2048 });
    expect(lastCall.expiresInSeconds).toBeLessThanOrEqual(900);
  });

  it('puts the profile photo in its own storage area with the photo type limits', async () => {
    const f = await family();
    const res = await upload(
      f,
      pdfBody({ documentType: 'PROFILE_PHOTO', fileName: 'me.jpg', mimeType: 'image/jpeg' }),
    );
    expect(res.status).toBe(201);
    expect(await keyOf(res.body.data.document.id)).toMatch(
      new RegExp(`^player-images/${f.regId}/`),
    );
    const pdfPhoto = await upload(
      f,
      pdfBody({ documentType: 'PROFILE_PHOTO', mimeType: 'application/pdf' }),
    );
    expect(pdfPhoto.status).toBe(400);
    expect(pdfPhoto.body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  it('rejects disallowed MIME types, oversize and bad sizes', async () => {
    const f = await family();
    for (const mimeType of [
      'text/html',
      'application/x-msdownload',
      'image/svg+xml',
      'application/zip',
    ]) {
      const res = await upload(f, pdfBody({ mimeType }));
      expect(res.status, mimeType).toBe(400);
      expect(res.body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    }
    const big = await upload(f, pdfBody({ sizeBytes: 10 * 1024 * 1024 + 1 }));
    expect(big.status).toBe(400);
    expect(big.body.error.code).toBe('FILE_TOO_LARGE');
    for (const sizeBytes of [0, -5, 1.5, '2048'])
      expect((await upload(f, pdfBody({ sizeBytes }))).status).toBe(422);
    const { rows } = await db.query('select 1 from public.documents where registration_id = $1', [
      f.regId,
    ]);
    expect(rows).toEqual([]); // nothing was created by the refused requests
  });

  it('only accepts the player document types the frontend defines', async () => {
    const f = await family();
    for (const documentType of [
      'SAFESPORT',
      'FIRST_AID_CPR',
      'PASSPORT',
      '',
      'birth_certificate',
    ]) {
      expect((await upload(f, pdfBody({ documentType }))).status, documentType).toBe(422);
    }
  });

  it('never accepts a client-supplied key, bucket, status or URL (strict body)', async () => {
    const f = await family();
    for (const extra of [
      { storageKey: 'registration-documents/x/y' },
      { storageBucket: 'b' },
      { status: 'APPROVED' },
      { url: 'https://evil' },
      { registrationId: f.regId },
    ]) {
      expect((await upload(f, pdfBody(extra))).status, JSON.stringify(extra)).toBe(422);
    }
  });

  it('neutralizes path tricks in the file name: it is metadata only and never part of the key', async () => {
    const f = await family();
    for (const fileName of [
      '../../etc/passwd.pdf',
      '..\\..\\windows\\win.pdf',
      'a/b/c.pdf',
      'x\u0000y\n.pdf',
    ]) {
      const res = await upload(f, pdfBody({ fileName }));
      expect(res.status).toBe(201);
      const forbidden = [
        String.fromCharCode(92),
        '/',
        String.fromCharCode(10),
        String.fromCharCode(0),
      ];
      expect(forbidden.some((c) => res.body.data.document.fileName.includes(c))).toBe(false);
      expect(await keyOf(res.body.data.document.id)).toMatch(
        new RegExp(`^registration-documents/${f.regId}/[0-9a-f-]{36}$`),
      );
      // replace for the next iteration
    }
    expect((await upload(f, pdfBody({ fileName: '../..//' }))).status).toBe(422); // nothing left of the name
  });

  it('scopes keys to the registration: another registration or family is unreachable', async () => {
    const f1 = await family();
    const f2 = await family();
    const stranger = await as(app, f2.parent.id).post(
      `${R}/${f1.regId}/documents/upload-url`,
      pdfBody(),
    );
    expect(stranger.status).toBe(404);
    expect(stranger.body.error.code).toBe('REGISTRATION_NOT_FOUND');
    expect((await upload({ ...f1, regId: '11111111-1111-4111-8111-111111111111' })).status).toBe(
      404,
    );
    for (const bad of ['nope', encodeURIComponent("1' OR '1'='1")]) {
      expect((await upload({ ...f1, regId: bad })).status).toBe(422);
    }
    expect(storage.uploadsFor(f2.regId)).toEqual([]);
    const ok = await upload(f2);
    expect(await keyOf(ok.body.data.document.id)).toContain(`/${f2.regId}/`);
  });

  it('answers 503 and creates nothing when the storage provider fails, without leaking its error', async () => {
    const f = await family();
    storage.failures.upload = true;
    const res = await upload(f);
    storage.failures.upload = false;
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('STORAGE_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toContain('AKIA');
    const { rows } = await db.query('select 1 from public.documents where registration_id = $1', [
      f.regId,
    ]);
    expect(rows).toEqual([]);
  });

  it('answers 503 for file operations (but still serves metadata) when storage is not configured', async () => {
    const f = await family();
    const bare = buildApi(db); // no storage configured
    const res = await as(bare, f.parent.id).post(`${R}/${f.regId}/documents/upload-url`, pdfBody());
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('STORAGE_NOT_CONFIGURED');
    expect((await as(bare, f.parent.id).get(`${R}/${f.regId}/documents`)).status).toBe(200);
  });
});

describe('completing an upload (the server verifies what was stored)', () => {
  it('confirms a matching upload and is idempotent', async () => {
    const f = await family();
    const id = await uploaded(f);
    const again = await as(app, f.parent.id).post(`${D}/${id}/complete`);
    expect(again.status).toBe(200);
    expect(again.body.data.state).toBe('UPLOADED');
    const { rows } = await db.query(
      "select 1 from public.audit_logs where entity_id = $1 and action = 'DOCUMENT_UPLOADED'",
      [id],
    );
    expect(rows).toHaveLength(1);
  });

  it('refuses when nothing was uploaded', async () => {
    const f = await family();
    const res = await upload(f);
    const done = await as(app, f.parent.id).post(`${D}/${res.body.data.document.id}/complete`);
    expect(done.status).toBe(409);
    expect(done.body.error.code).toBe('UPLOAD_NOT_COMPLETE');
  });

  it('refuses and deletes a file whose contents do not match the declared type', async () => {
    const f = await family();
    const cases: [string, Uint8Array, string][] = [
      ['html as pdf', fileBytes.html(), 'FILE_CONTENT_MISMATCH'],
      ['exe as pdf', fileBytes.exe(), 'FILE_CONTENT_MISMATCH'],
      ['png as pdf', fileBytes.png(), 'FILE_CONTENT_MISMATCH'],
      ['wrong size', fileBytes.pdf(4096), 'FILE_SIZE_MISMATCH'],
    ];
    for (const [name, bytes, code] of cases) {
      const res = await upload(f);
      const id = res.body.data.document.id;
      const key = await keyOf(id);
      storage.put(key, bytes);
      const done = await as(app, f.parent.id).post(`${D}/${id}/complete`);
      expect(done.status, name).toBe(422);
      expect(done.body.error.code, name).toBe(code);
      expect(storage.objects.has(key), name).toBe(false); // the bad file is not kept
      const state = await as(app, f.parent.id).get(`${D}/${id}`);
      expect(state.body.data.state).toBe('AWAITING_UPLOAD');
    }
  });

  it('answers 503 when the storage provider fails while verifying', async () => {
    const f = await family();
    const res = await upload(f);
    storage.put(await keyOf(res.body.data.document.id), fileBytes.pdf());
    storage.failures.inspect = true;
    const done = await as(app, f.parent.id).post(`${D}/${res.body.data.document.id}/complete`);
    storage.failures.inspect = false;
    expect(done.status).toBe(503);
    expect(done.body.error.code).toBe('STORAGE_UNAVAILABLE');
  });

  it('lets only the owner confirm, and tolerates a simultaneous double confirm', async () => {
    const f = await family();
    const stranger = await createUser(db, { roles: ['PARENT'] });
    const res = await upload(f);
    const id = res.body.data.document.id;
    storage.put(await keyOf(id), fileBytes.pdf());
    expect((await as(app, stranger.id).post(`${D}/${id}/complete`)).status).toBe(404);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => as(app, f.parent.id).post(`${D}/${id}/complete`)),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    const { rows } = await db.query(
      "select 1 from public.audit_logs where entity_id = $1 and action = 'DOCUMENT_UPLOADED'",
      [id],
    );
    expect(rows).toHaveLength(1);
  });
});

describe('review workflow', () => {
  it('upload -> submit -> approve, without touching the registration status', async () => {
    const f = await family();
    const id = await uploaded(f);
    const before = (await as(app, f.parent.id).get(`${R}/${f.regId}`)).body.data.status;

    const sub = await as(app, f.parent.id).post(`${D}/${id}/submit`);
    expect(sub.body.data).toMatchObject({ state: 'IN_REVIEW', review: null });
    const ok = await approve(adminA, id);
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({
      state: 'APPROVED',
      review: { decision: 'APPROVED', reasonCode: null, reason: null },
    });

    expect((await as(app, f.parent.id).get(`${R}/${f.regId}`)).body.data.status).toBe(before);
    const { rows } = await db.query(
      'select count(*)::int as n from public.registration_status_history where registration_id = $1',
      [f.regId],
    );
    expect(rows[0]!.n).toBe(1); // only the initial DRAFT: approving a document wrote no registration history
    const { rows: audit } = await db.query(
      'select action from public.audit_logs where entity_id = $1 order by action',
      [id],
    );
    expect(audit.map((a) => a.action)).toEqual([
      'DOCUMENT_APPROVED',
      'DOCUMENT_SUBMITTED',
      'DOCUMENT_UPLOAD_REQUESTED',
      'DOCUMENT_UPLOADED',
    ]);
  });

  it('rejects with a reason code and text that the family can read', async () => {
    const f = await family();
    const id = await submitted(f);
    const res = await reject(adminA, id, {
      reasonCode: 'NAME_MISMATCH',
      reason: 'Name does not match the player.',
      notes: 'internal: check with league',
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      state: 'REJECTED',
      review: {
        decision: 'REJECTED',
        reasonCode: 'NAME_MISMATCH',
        reason: 'Name does not match the player.',
      },
    });
    const family_view = await as(app, f.parent.id).get(`${D}/${id}`);
    expect(family_view.body.data.review.reason).toBe('Name does not match the player.');
    expect(JSON.stringify(family_view.body)).not.toContain('internal: check');
    const { rows } = await db.query(
      'select decision, reviewer_id, notes from public.document_reviews where document_id = $1',
      [id],
    );
    expect(rows).toEqual([
      { decision: 'REJECTED', reviewer_id: adminA, notes: 'internal: check with league' },
    ]);
  });

  it('requires a reason code and text to reject, and refuses stray fields', async () => {
    const f = await family();
    const id = await submitted(f);
    for (const body of [
      { decision: 'REJECTED' },
      { decision: 'REJECTED', reasonCode: 'UNREADABLE' },
      { decision: 'REJECTED', reasonCode: 'UNREADABLE', reason: '   ' },
      { decision: 'REJECTED', reasonCode: 'MADE_UP', reason: 'x' },
      { decision: 'APPROVED', reason: 'why' },
      { decision: 'MAYBE' },
      {},
    ]) {
      expect(
        (await as(app, adminA).patch(`${D}/${id}/review`, body)).status,
        JSON.stringify(body),
      ).toBe(422);
    }
    expect((await as(app, f.parent.id).get(`${D}/${id}`)).body.data.state).toBe('IN_REVIEW');
  });

  it('lets the family replace a rejected document with a new upload, keeping the history', async () => {
    const f = await family();
    const first = await submitted(f);
    const oldKey = await keyOf(first);
    await reject(adminA, first);
    const second = await uploaded(f);
    expect(second).not.toBe(first);
    expect(await keyOf(second)).not.toBe(oldKey);
    expect(storage.objects.has(oldKey)).toBe(true); // the rejected file stays as evidence of the rejection
    await as(app, f.parent.id).post(`${D}/${second}/submit`);
    await approve(adminA, second);

    const list = await as(app, f.parent.id).get(`${R}/${f.regId}/documents`);
    expect(
      list.body.data.documents.map((d: { id: string; state: string }) => [d.id, d.state]).sort(),
    ).toEqual(
      [
        [first, 'REJECTED'],
        [second, 'APPROVED'],
      ].sort(),
    );
    expect(
      list.body.data.completeness.required.find(
        (r: { documentType: string }) => r.documentType === 'BIRTH_CERTIFICATE',
      ).state,
    ).toBe('APPROVED');
    const { rows } = await db.query(
      "select action from public.audit_logs where entity_id = $1 and action = 'DOCUMENT_REPLACED'",
      [second],
    );
    expect(rows).toHaveLength(1);
  });

  it('replaces an unsubmitted document in place and removes the old file', async () => {
    const f = await family();
    const id = await uploaded(f);
    const oldKey = await keyOf(id);
    const res = await upload(f, pdfBody({ fileName: 'better.pdf', sizeBytes: 3000 }));
    expect(res.status).toBe(201);
    expect(res.body.data.document).toMatchObject({
      id,
      fileName: 'better.pdf',
      sizeBytes: 3000,
      state: 'AWAITING_UPLOAD',
    });
    expect(await keyOf(id)).not.toBe(oldKey);
    expect(storage.objects.has(oldKey)).toBe(false);
    const { rows } = await db.query(
      "select action from public.audit_logs where entity_id = $1 and action = 'DOCUMENT_REPLACED'",
      [id],
    );
    expect(rows).toHaveLength(1);
    const { rows: docs } = await db.query(
      'select 1 from public.documents where registration_id = $1',
      [f.regId],
    );
    expect(docs).toHaveLength(1);
  });

  it('refuses to replace a document that is in review or approved', async () => {
    const f = await family();
    const id = await submitted(f);
    const inReview = await upload(f);
    expect(inReview.status).toBe(409);
    expect(inReview.body.error.code).toBe('DOCUMENT_IN_REVIEW');
    await approve(adminA, id);
    const approved = await upload(f);
    expect(approved.status).toBe(409);
    expect(approved.body.error.code).toBe('DOCUMENT_ALREADY_APPROVED');
  });

  it('refuses invalid state transitions with 409 and changes nothing', async () => {
    const f = await family();
    const waiting = (await upload(f)).body.data.document.id;
    const noFile = await as(app, f.parent.id).post(`${D}/${waiting}/submit`);
    expect(noFile.body.error.code).toBe('DOCUMENT_NOT_UPLOADED');
    expect((await approve(adminA, waiting)).body.error.code).toBe('DOCUMENT_NOT_SUBMITTED');
    expect((await as(app, f.parent.id).get(`${D}/${waiting}/download-url`)).body.error.code).toBe(
      'DOCUMENT_NOT_UPLOADED',
    );

    const id = await submitted(f, pdfBody({ documentType: 'SCHOOL_ID' }));
    expect((await as(app, f.parent.id).post(`${D}/${id}/submit`)).body.error.code).toBe(
      'DOCUMENT_ALREADY_SUBMITTED',
    );
    await approve(adminA, id);
    expect((await approve(adminA, id)).body.error.code).toBe('DOCUMENT_ALREADY_REVIEWED');
    expect((await reject(adminA, id)).body.error.code).toBe('DOCUMENT_ALREADY_REVIEWED');
    expect((await as(app, f.parent.id).post(`${D}/${id}/submit`)).body.error.code).toBe(
      'INVALID_DOCUMENT_STATE',
    );

    const rejectedId = await submitted(f, pdfBody({ documentType: 'SCHOOL_TRANSCRIPT' }));
    await reject(adminA, rejectedId);
    expect((await as(app, f.parent.id).post(`${D}/${rejectedId}/complete`)).body.error.code).toBe(
      'INVALID_DOCUMENT_STATE',
    );
    const { rows } = await db.query('select status from public.documents where id = $1', [id]);
    expect(rows[0]!.status).toBe('APPROVED');
  });

  it('freezes documents of a cancelled registration', async () => {
    const f = await family();
    const id = await uploaded(f);
    await db.query("update public.registrations set status = 'CANCELLED' where id = $1", [f.regId]);
    for (const res of [
      await upload(f, pdfBody({ documentType: 'SCHOOL_ID' })),
      await as(app, f.parent.id).post(`${D}/${id}/submit`),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('REGISTRATION_CLOSED');
    }
  });

  it('caps repeated uploads of a rejected document', async () => {
    const f = await family();
    for (let i = 0; i < 10; i++) {
      const id = await submitted(f);
      expect((await reject(adminA, id)).status).toBe(200);
    }
    const res = await upload(f);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TOO_MANY_ATTEMPTS');
  });
});

describe('concurrency', () => {
  it('keeps one live document per type when uploads are requested simultaneously', async () => {
    const f = await family();
    const results = await Promise.all(Array.from({ length: 6 }, () => upload(f)));
    expect(results.map((r) => r.status).every((s) => s === 201 || s === 409)).toBe(true);
    expect(results.some((r) => r.status === 201)).toBe(true);
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.documents where registration_id = $1 and document_type = 'BIRTH_CERTIFICATE' and status <> 'REJECTED'",
      [f.regId],
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('lets exactly one of several simultaneous reviews win', async () => {
    const f = await family();
    const id = await submitted(f);
    const results = await Promise.all([
      approve(adminA, id),
      approve(adminA, id),
      reject(adminA, id),
      reject(adminA, id),
      approve(adminA, id),
    ]);
    const wins = results.filter((r) => r.status === 200);
    expect(wins).toHaveLength(1);
    for (const r of results.filter((r) => r.status !== 200))
      expect(r.body.error.code).toBe('DOCUMENT_ALREADY_REVIEWED');
    const { rows } = await db.query<{ n: number }>(
      'select count(*)::int as n from public.document_reviews where document_id = $1',
      [id],
    );
    expect(rows[0]!.n).toBe(1);
    const { rows: doc } = await db.query<{ status: string }>(
      'select status from public.documents where id = $1',
      [id],
    );
    expect(doc[0]!.status).toBe(wins[0]!.body.data.state);
  });

  it('lets exactly one of several simultaneous submits win', async () => {
    const f = await family();
    const id = await uploaded(f);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => as(app, f.parent.id).post(`${D}/${id}/submit`)),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
  });

  it('refuses a replacement that races with a submission, never losing the submitted file', async () => {
    const f = await family();
    const id = await uploaded(f);
    const key = await keyOf(id);
    const [a, b] = await Promise.all([as(app, f.parent.id).post(`${D}/${id}/submit`), upload(f)]);
    const { rows } = await db.query<{
      storage_key: string;
      submitted_at: Date | null;
      uploaded_at: Date | null;
    }>('select storage_key, submitted_at, uploaded_at from public.documents where id = $1', [id]);
    if (a.status === 200) {
      expect(b.status).toBe(409); // submitted first: the replacement is refused
      expect(rows[0]!.storage_key).toBe(key);
    } else {
      expect(rows[0]!.submitted_at).toBeNull(); // replaced first: the submit found no file
      expect(rows[0]!.uploaded_at).toBeNull();
    }
  });
});

describe('reading and downloading: authorization', () => {
  it('lets the owner list, read and download, with a short-lived private URL', async () => {
    const f = await family();
    const id = await submitted(f);
    const list = await as(app, f.parent.id).get(`${R}/${f.regId}/documents`);
    expect(list.status).toBe(200);
    expect(list.body.data.documents).toHaveLength(1);
    expect((await as(app, f.parent.id).get(`${D}/${id}`)).status).toBe(200);

    const dl = await as(app, f.parent.id).get(`${D}/${id}/download-url`);
    expect(dl.status).toBe(200);
    expect(dl.headers['cache-control']).toBe('no-store');
    expect(dl.body.data.url).toContain(await keyOf(id));
    expect(new Date(dl.body.data.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(
      15 * 60_000,
    );
    const call = storage.calls.filter((c) => c.op === 'download').at(-1)!;
    expect(call.expiresInSeconds).toBeLessThanOrEqual(900);
    expect(Object.keys(dl.body.data).sort()).toEqual(['expiresAt', 'url']);
    // the URL is not stored anywhere
    const { rows } = await db.query(
      "select 1 from public.audit_logs where metadata::text like '%storage.test%' or metadata::text like '%Signature%'",
    );
    expect(rows).toEqual([]);
    const { rows: audit } = await db.query(
      "select 1 from public.audit_logs where entity_id = $1 and action = 'DOCUMENT_DOWNLOAD_URL_ISSUED'",
      [id],
    );
    expect(audit).toHaveLength(1);
  });

  it('works the same for a player who manages their own registration', async () => {
    const player = await createUser(db, { roles: ['PLAYER'] });
    const p = await as(app, player.id).post('/api/v1/players', {
      firstName: 'Ann',
      lastName: 'Adult',
      dateOfBirth: '1999-01-01',
      forSelf: true,
    });
    const reg = await as(app, player.id).post(R, {
      eventId: eventA,
      playerId: p.body.data.id,
      teamId: teamA,
    });
    const self: Family = { parent: player, playerId: p.body.data.id, regId: reg.body.data.id };
    const id = await uploaded(self);
    expect((await as(app, player.id).get(`${D}/${id}`)).status).toBe(200);
    expect((await as(app, player.id).get(`${D}/${id}/download-url`)).status).toBe(200);
  });

  it("hides another family's documents with 404 on every endpoint", async () => {
    const owner = await family();
    const stranger = await createUser(db, { roles: ['PARENT'] });
    const id = await submitted(owner);
    const s = as(app, stranger.id);
    const attempts = [
      await s.get(`${R}/${owner.regId}/documents`),
      await s.get(`${D}/${id}`),
      await s.get(`${D}/${id}/download-url`),
      await s.post(`${D}/${id}/submit`),
      await s.post(`${D}/${id}/complete`),
      await s.post(
        `${R}/${owner.regId}/documents/upload-url`,
        pdfBody({ documentType: 'SCHOOL_ID' }),
      ),
    ];
    for (const res of attempts) expect(res.status).toBe(404);
    expect(JSON.stringify(attempts.map((r) => r.body))).not.toContain(id);
    expect(
      storage.calls.filter(
        (c) => c.op === 'download' && c.key === (undefined as unknown as string),
      ),
    ).toEqual([]);
  });

  it('requires authentication on every endpoint', async () => {
    const f = await family();
    const id = await submitted(f);
    const anon = [
      await request(app).get(`${R}/${f.regId}/documents`),
      await request(app).post(`${R}/${f.regId}/documents/upload-url`).send(pdfBody()),
      await request(app).get(`${D}/${id}`),
      await request(app).get(`${D}/${id}/download-url`),
      await request(app).post(`${D}/${id}/complete`),
      await request(app).post(`${D}/${id}/submit`),
      await request(app).patch(`${D}/${id}/review`).send({ decision: 'APPROVED' }),
    ];
    for (const res of anon) expect(res.status).toBe(401);
  });

  it('gives admins access by organization, and only to submitted documents (cross-organization is 404)', async () => {
    const f = await family();
    const draftId = await uploaded(f, pdfBody({ documentType: 'SCHOOL_ID' }));
    const id = await submitted(f);

    // admin of the event's organization: sees the submitted one, not the family's unsubmitted draft
    const list = await as(app, adminA).get(`${R}/${f.regId}/documents`);
    expect(list.status).toBe(200);
    expect(list.body.data.documents.map((d: { id: string }) => d.id)).toEqual([id]);
    expect((await as(app, adminA).get(`${D}/${id}`)).status).toBe(200);
    expect((await as(app, adminA).get(`${D}/${id}/download-url`)).status).toBe(200);
    expect((await as(app, adminA).get(`${D}/${draftId}`)).status).toBe(404);
    expect((await as(app, adminA).get(`${D}/${draftId}/download-url`)).status).toBe(404);

    // admin of another organization: nothing at all
    const b = as(app, adminB);
    for (const res of [
      await b.get(`${R}/${f.regId}/documents`),
      await b.get(`${D}/${id}`),
      await b.get(`${D}/${id}/download-url`),
      await approve(adminB, id),
    ]) {
      expect(res.status).toBe(404);
    }
    const { rows } = await db.query('select status from public.documents where id = $1', [id]);
    expect(rows[0]!.status).toBe('PENDING');
  });

  it('keeps events separate (cross-event): documents are listed only for their own registration', async () => {
    const parent = await createUser(db, { roles: ['PARENT'] });
    const playerId = await createChild(app, parent.id);
    const event2 = await createEvent(db, orgA);
    const r1 = (await as(app, parent.id).post(R, { eventId: eventA, playerId })).body.data
      .id as string;
    const r2 = (await as(app, parent.id).post(R, { eventId: event2, playerId })).body.data
      .id as string;
    const d1 = await uploaded({ parent, playerId, regId: r1 });
    const list2 = await as(app, parent.id).get(`${R}/${r2}/documents`);
    expect(list2.body.data.documents).toEqual([]);
    expect(JSON.stringify(list2.body)).not.toContain(d1);
    const up2 = await upload({ parent, playerId, regId: r2 });
    expect(await keyOf(up2.body.data.document.id)).toContain(`/${r2}/`);
    expect(await keyOf(d1)).toContain(`/${r1}/`);
  });

  it('applies role gates: only registrants upload (and only their own), only ADMIN review', async () => {
    const f = await family();
    const id = await submitted(f);
    for (const roles of [[], ['ADMIN']] as const) {
      const u = await createUser(db, { roles: [...roles], organizationId: orgA });
      expect(
        (await as(app, u.id).post(`${R}/${f.regId}/documents/upload-url`, pdfBody())).status,
      ).toBe(403);
      expect((await as(app, u.id).post(`${D}/${id}/submit`)).status).toBe(403);
    }
    // Coach and staff accounts may upload for their own registration, but another family's does not exist for them.
    for (const roles of [['COACH'], ['STAFF']] as const) {
      const u = await createUser(db, { roles: [...roles], organizationId: orgA });
      expect(
        (await as(app, u.id).post(`${R}/${f.regId}/documents/upload-url`, pdfBody())).status,
      ).toBe(404);
      expect((await as(app, u.id).post(`${D}/${id}/submit`)).status).toBe(404);
    }
    for (const roles of [['PARENT'], ['COACH'], []] as const) {
      const u = await createUser(db, { roles: [...roles], organizationId: orgA });
      expect(
        (await as(app, u.id).patch(`${D}/${id}/review`, { decision: 'APPROVED' })).status,
      ).toBe(403);
    }
    expect(
      (await as(app, f.parent.id).patch(`${D}/${id}/review`, { decision: 'APPROVED' })).status,
    ).toBe(403); // owners cannot approve their own
  });
});

describe('defence in depth behind the API', () => {
  it("refuses to sign a download for a key outside the document's registration, or a malformed key", async () => {
    const f1 = await family();
    const f2 = await family();
    const id = await submitted(f1);
    const other = await submitted(f2);
    void other;
    const foreign = `registration-documents/${f2.regId}/33333333-3333-4333-8333-333333333333`;
    for (const key of [
      foreign,
      'garbage',
      '../../etc/passwd',
      `registration-documents/${f1.regId}/../${f2.regId}/x`,
      `other-area/${f1.regId}/33333333-3333-4333-8333-333333333333`,
    ]) {
      await db.query('update public.documents set storage_key = $2 where id = $1', [id, key]);
      const res = await as(app, f1.parent.id).get(`${D}/${id}/download-url`);
      expect(res.status, key).toBe(403);
      expect(res.body.error.code).toBe('STORAGE_KEY_DENIED');
    }
    expect(storage.calls.filter((c) => c.op === 'download' && c.key === 'garbage')).toEqual([]);
  });

  it('answers 503 when the storage provider fails while signing a download', async () => {
    const f = await family();
    const id = await submitted(f);
    storage.failures.download = true;
    const res = await as(app, f.parent.id).get(`${D}/${id}/download-url`);
    storage.failures.download = false;
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('STORAGE_UNAVAILABLE');
  });

  it('is enforced by the database: no moving a document, no review before submission, no submit before upload', async () => {
    const f = await family();
    const f2 = await family();
    const id = (await upload(f)).body.data.document.id as string;
    const run = (sql: string, params: unknown[]) =>
      db.query(sql, params).then(
        () => '',
        (e: Error) => e.message,
      );
    expect(
      await run('update public.documents set registration_id = $2 where id = $1', [id, f2.regId]),
    ).toMatch(/cannot be moved/);
    expect(
      await run("update public.documents set document_type = 'SCHOOL_ID' where id = $1", [id]),
    ).toMatch(/cannot be moved/);
    expect(
      await run("update public.documents set status = 'APPROVED' where id = $1", [id]),
    ).toMatch(/review_requires_submission/);
    expect(
      await run('update public.documents set submitted_at = now() where id = $1', [id]),
    ).toMatch(/submission_requires_upload/);
    expect(await run('delete from public.document_reviews', [])).toMatch(/append-only/);
  });
});

describe('completeness is separate from the registration status', () => {
  it('reports required documents and whether all are approved', async () => {
    const f = await family();
    const get = async () =>
      (await as(app, f.parent.id).get(`${R}/${f.regId}/documents`)).body.data.completeness;
    const start = await get();
    expect(start.allRequiredApproved).toBe(false);
    expect(
      start.required.map((r: { documentType: string; state: string }) => [r.documentType, r.state]),
    ).toEqual([
      ['PROFILE_PHOTO', 'MISSING'],
      ['BIRTH_CERTIFICATE', 'MISSING'],
      ['SCHOOL_TRANSCRIPT', 'MISSING'],
      ['CALIFORNIA_KID_ID', 'MISSING'],
    ]);

    const specs: [string, string, string][] = [
      ['PROFILE_PHOTO', 'image/jpeg', 'jpeg'],
      ['BIRTH_CERTIFICATE', 'application/pdf', 'pdf'],
      ['SCHOOL_TRANSCRIPT', 'application/pdf', 'pdf'],
      ['CALIFORNIA_KID_ID', 'image/png', 'png'],
    ];
    for (const [i, [documentType, mimeType, kind]] of specs.entries()) {
      const id = await submitted(
        f,
        pdfBody({ documentType, mimeType, fileName: `${documentType}.x` }),
      );
      void kind;
      await approve(adminA, id);
      expect((await get()).allRequiredApproved).toBe(i === specs.length - 1);
    }
    // an optional document never counts, and registration status is untouched
    expect((await as(app, f.parent.id).get(`${R}/${f.regId}`)).body.data.status).toBe('DRAFT');
  });

  it('shows a rejected required document as REJECTED (needs replacing), not approved', async () => {
    const f = await family();
    const id = await submitted(f);
    await reject(adminA, id);
    const c = (await as(app, f.parent.id).get(`${R}/${f.regId}/documents`)).body.data.completeness;
    expect(
      c.required.find((r: { documentType: string }) => r.documentType === 'BIRTH_CERTIFICATE')
        .state,
    ).toBe('REJECTED');
    expect(c.allRequiredApproved).toBe(false);
  });
});

describe('sensitive data protection', () => {
  it('writes no URLs, keys, credentials or file contents to the logs or the audit trail', async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _e, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const logger = pino(
      { level: 'trace', redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } },
      sink,
    );
    const logged = buildApi(db, { logger, storage });
    const f = await family();

    const res = await as(logged, f.parent.id).post(
      `${R}/${f.regId}/documents/upload-url`,
      pdfBody(),
    );
    const id = res.body.data.document.id as string;
    const key = await keyOf(id);
    storage.put(key, fileBytes.pdf());
    await as(logged, f.parent.id).post(`${D}/${id}/complete`);
    await as(logged, f.parent.id).post(`${D}/${id}/submit`);
    const dl = await as(logged, f.parent.id).get(`${D}/${id}/download-url`);
    storage.failures.download = true;
    await as(logged, f.parent.id).get(`${D}/${id}/download-url`); // a 503 path logs the error server-side
    storage.failures.download = false;

    const output = lines.join('');
    expect(output.length).toBeGreaterThan(0);
    for (const secret of [
      res.body.data.upload.url,
      dl.body.data.url,
      key,
      'X-Signature',
      'storage.test',
      'AKIA',
      '%PDF',
    ]) {
      expect(output, secret).not.toContain(secret);
    }
    const { rows } = await db.query<{ metadata: unknown }>(
      'select metadata from public.audit_logs where entity_id = $1',
      [id],
    );
    const audit = JSON.stringify(rows);
    for (const secret of [key, 'storage.test', 'X-Signature', 'birth certificate'])
      expect(audit).not.toContain(secret);
  });

  it('stores hostile text literally and never executes it', async () => {
    const f = await family();
    const res = await upload(f, pdfBody({ fileName: "x'); DROP TABLE public.documents;--.pdf" }));
    expect(res.status).toBe(201);
    expect(res.body.data.document.fileName).toBe("x'); DROP TABLE public.documents;--.pdf");
    for (const bad of [encodeURIComponent("1' OR '1'='1"), 'not-a-uuid']) {
      expect((await as(app, f.parent.id).get(`${D}/${bad}`)).status).toBe(422);
      expect((await as(app, f.parent.id).get(`${D}/${bad}/download-url`)).status).toBe(422);
    }
    const { rows } = await db.query('select 1 from public.documents limit 1');
    expect(rows).toHaveLength(1);
  });
});
