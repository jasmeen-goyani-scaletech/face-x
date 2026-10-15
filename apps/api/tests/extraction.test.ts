import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REDACT_PATHS } from '../src/config/logger';
import type { Database } from '../src/infrastructure/database/database';
import type { DocumentExtractionConfig } from '../src/modules/extraction';
import { as, createChild, createEvent, createOrg, createTeam } from './helpers/fixtures';
import { createFakeExtractor, markedFile } from './helpers/fake-extractor';
import { createFakeStorage, type FakeStorage } from './helpers/fake-storage';
import { buildApi, createUser, openTestDb } from './helpers/test-app';

/** POST /documents/:id/extract against the real app and PostgreSQL, with a fake provider driven by the file's bytes. */
let db: Database;
let storage: FakeStorage;
let fake: ReturnType<typeof createFakeExtractor>;
let app: ReturnType<typeof buildApi>;
let orgA: string;
let eventA: string;
let teamA: string;
let adminA: string;
let adminB: string;

const R = '/api/v1/registrations';
const D = '/api/v1/documents';
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34];
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// 10:00 in Los Angeles on 15 November 2026: the event's local date is 2026-11-15.
const EVENT_START = new Date('2026-11-15T18:00:00Z');

const config = (over: Partial<DocumentExtractionConfig> = {}): DocumentExtractionConfig => ({
  extractor: fake.extractor,
  timeoutMs: 5_000,
  maxBytes: 5 * 1024 * 1024,
  ...over,
});

beforeAll(async () => {
  db = openTestDb();
  storage = createFakeStorage();
  fake = createFakeExtractor();
  app = buildApi(db, { storage, documentExtraction: config() });
  orgA = await createOrg(db);
  const orgB = await createOrg(db);
  eventA = await createEvent(db, orgA, { startsAt: EVENT_START });
  teamA = await createTeam(db, eventA);
  adminA = (await createUser(db, { roles: ['ADMIN'], organizationId: orgA })).id;
  adminB = (await createUser(db, { roles: ['ADMIN'], organizationId: orgB })).id;
});
afterAll(() => db.close());

async function family() {
  const parent = await createUser(db, { roles: ['PARENT'] });
  const playerId = await createChild(app, parent.id, {
    firstName: 'Tai',
    lastName: 'Mateialona-Howe',
    dateOfBirth: '2011-08-29',
  });
  const res = await as(app, parent.id).post(R, { eventId: eventA, playerId, teamId: teamA });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { ownerId: parent.id, regId: res.body.data.id as string };
}

async function coach() {
  const user = await createUser(db, { roles: ['COACH'] });
  const profile = await as(app, user.id).post('/api/v1/staff-profiles', {
    profileType: 'COACH',
    firstName: 'Casey',
    lastName: 'Coach',
    email: `${randomUUID()}@example.com`,
    phone: '555-019-2831',
  });
  expect(profile.status, JSON.stringify(profile.body)).toBe(201);
  const reg = await as(app, user.id).post(R, {
    eventId: eventA,
    staffProfileId: profile.body.data.id,
  });
  expect(reg.status, JSON.stringify(reg.body)).toBe(201);
  return { ownerId: user.id, regId: reg.body.data.id as string };
}
type Owner = { ownerId: string; regId: string };

const keyOf = async (documentId: string) =>
  (
    await db.query<{ storage_key: string }>(
      'select storage_key from public.documents where id = $1',
      [documentId],
    )
  ).rows[0]!.storage_key;

/** Requests an upload, "uploads" the bytes and confirms. Returns the document id. */
async function uploaded(
  o: Owner,
  bytes: Uint8Array,
  { documentType = 'BIRTH_CERTIFICATE', mimeType = 'image/jpeg', complete = true } = {},
) {
  const res = await as(app, o.ownerId).post(`${R}/${o.regId}/documents/upload-url`, {
    documentType,
    fileName: 'scan',
    mimeType,
    sizeBytes: bytes.length,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const id = res.body.data.document.id as string;
  storage.put(await keyOf(id), bytes);
  if (complete) {
    const done = await as(app, o.ownerId).post(`${D}/${id}/complete`);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
  }
  return id;
}

const fieldsFile = (fields: Record<string, string>, head = JPEG) =>
  markedFile(head, `FIELDS:${JSON.stringify(fields)}`);
const extract = (userId: string, documentId: string, on = app) =>
  as(on, userId).post(`${D}/${documentId}/extract`);

describe('extracting fields from a document', () => {
  it('reads the configured fields and compares them with the player on record', async () => {
    const f = await family();
    const id = await uploaded(
      f,
      fieldsFile({
        firstName: 'TAI',
        middleName: 'Lani',
        lastName: 'MATEIALONA HOWE',
        fullName: 'Tai Lani Mateiáloná-Howe',
        dateOfBirth: '08/29/2011',
      }),
    );
    const before = fake.calls.length;
    const res = await extract(f.ownerId, id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data).toEqual({
      documentId: id,
      documentType: 'BIRTH_CERTIFICATE',
      status: 'SUCCEEDED',
      fields: {
        firstName: { value: 'TAI', match: 'MATCH' },
        middleName: { value: 'Lani', match: null },
        lastName: { value: 'MATEIALONA HOWE', match: 'MATCH' },
        fullName: { value: 'Tai Lani Mateiáloná-Howe', match: 'MATCH' },
        dateOfBirth: { value: '2011-08-29', match: 'MATCH' },
      },
      derived: { age: 15 },
      model: 'fake-model-1',
      verdict: { accepted: true, message: null },
    });
    // The provider got the sniffed type and the field list for the type, nothing chosen by the client.
    expect(fake.calls.length).toBe(before + 1);
    expect(fake.calls.at(-1)!.mimeType).toBe('image/jpeg');
    expect(fake.calls.at(-1)!.fields.map((x) => x.key)).toEqual([
      'firstName',
      'middleName',
      'lastName',
      'fullName',
      'dateOfBirth',
    ]);
  });

  it('reports mismatches and values the document does not give', async () => {
    const f = await family();
    const id = await uploaded(
      f,
      fieldsFile({ firstName: 'Tia', fullName: 'Tia Howe', dateOfBirth: '2011-08-30' }, PDF),
      { documentType: 'SCHOOL_TRANSCRIPT', mimeType: 'application/pdf' },
    );
    const res = await extract(f.ownerId, id);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('SUCCEEDED');
    expect(res.body.data.fields).toEqual({
      firstName: { value: 'Tia', match: 'MISMATCH' },
      middleName: { value: null, match: null },
      lastName: { value: null, match: 'NOT_FOUND' },
      fullName: { value: 'Tia Howe', match: 'MISMATCH' },
      dateOfBirth: { value: '2011-08-30', match: 'MISMATCH' },
    });
    expect(res.body.data.derived).toEqual({ age: 15 });
    expect(fake.calls.at(-1)!.mimeType).toBe('application/pdf');
    // A name and a date of birth that contradict the profile are a rejection, with a message the family can act on.
    expect(res.body.data.verdict.accepted).toBe(false);
    expect(res.body.data.verdict.message).toContain('the name on it does not match');
    expect(res.body.data.verdict.message).toContain('the date of birth on it does not match');
  });

  it("checks a coach's certificate by name and expiry against the event date", async () => {
    const c = await coach();
    const valid = await uploaded(
      c,
      fieldsFile({ fullName: 'CASEY COACH', expiryDate: '2026-11-15', issuer: 'Red Cross' }, PDF),
      { documentType: 'FIRST_AID_CPR', mimeType: 'application/pdf' },
    );
    const res = await extract(c.ownerId, valid);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.fields).toEqual({
      fullName: { value: 'CASEY COACH', match: 'MATCH' },
      issueDate: { value: null, match: null },
      expiryDate: { value: '2026-11-15', match: 'MATCH' },
      issuer: { value: 'Red Cross', match: null },
    });
    expect(res.body.data.derived).toEqual({});

    const expired = await uploaded(
      c,
      fieldsFile({ fullName: 'Casey Coach', expiryDate: 'November 14, 2026' }, PDF),
      { documentType: 'YALF_TACKLE', mimeType: 'application/pdf' },
    );
    const late = await extract(c.ownerId, expired);
    expect(late.body.data.fields.expiryDate).toEqual({ value: '2026-11-14', match: 'MISMATCH' });
  });

  it('reads a DOCX upload and sends it to the provider as DOCX', async () => {
    const c = await coach();
    const id = await uploaded(c, fieldsFile({ fullName: 'Casey Coach' }, ZIP), {
      documentType: 'BACKGROUND_CHECK',
      mimeType: DOCX,
    });
    const res = await extract(c.ownerId, id);
    expect(res.status).toBe(200);
    expect(res.body.data.fields.fullName).toEqual({ value: 'Casey Coach', match: 'MATCH' });
    expect(fake.calls.at(-1)!.mimeType).toBe(DOCX);
  });
});

describe('who may extract', () => {
  it('lets an admin of the event organization extract a submitted document; others get 404', async () => {
    const f = await family();
    const id = await uploaded(f, fieldsFile({ firstName: 'Tai' }));
    // Not submitted yet: the admin does not see drafts.
    expect((await extract(adminA, id)).status).toBe(404);
    expect((await as(app, f.ownerId).post(`${D}/${id}/submit`)).status).toBe(200);
    const res = await extract(adminA, id);
    expect(res.status).toBe(200);
    expect(res.body.data.fields.firstName.match).toBe('MATCH');

    const stranger = await createUser(db, { roles: ['PARENT'] });
    for (const userId of [adminB, stranger.id]) {
      const denied = await extract(userId, id);
      expect(denied.status).toBe(404);
      expect(denied.body.error.code).toBe('DOCUMENT_NOT_FOUND');
    }
    expect((await extract(f.ownerId, randomUUID())).status).toBe(404);
  });

  it('answers 409 before the upload is complete', async () => {
    const f = await family();
    const id = await uploaded(f, fieldsFile({ firstName: 'Tai' }), { complete: false });
    const res = await extract(f.ownerId, id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('UPLOAD_NOT_COMPLETE');
  });

  it('answers 422 for the profile photo, which has nothing to extract', async () => {
    const f = await family();
    const id = await uploaded(f, markedFile(JPEG, 'photo'), { documentType: 'PROFILE_PHOTO' });
    const res = await extract(f.ownerId, id);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('DOCUMENT_NOT_EXTRACTABLE');
  });

  it('answers 503 when no provider is configured', async () => {
    const f = await family();
    const id = await uploaded(f, fieldsFile({ firstName: 'Tai' }));
    const bare = buildApi(db, { storage });
    const res = await extract(f.ownerId, id, bare);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('EXTRACTION_NOT_CONFIGURED');
  });

  it('limits extractions per user', async () => {
    const f = await family();
    const id = await uploaded(f, fieldsFile({ firstName: 'Tai' }));
    const limited = buildApi(db, {
      storage,
      documentExtraction: config(),
      extractionsPerMinute: 2,
    });
    expect((await extract(f.ownerId, id, limited)).status).toBe(200);
    expect((await extract(f.ownerId, id, limited)).status).toBe(200);
    expect((await extract(f.ownerId, id, limited)).status).toBe(429);
  });
});

describe('when extraction fails', () => {
  const failed = async (bytes: Uint8Array, on = app) => {
    const f = await family();
    const id = await uploaded(f, bytes);
    const res = await extract(f.ownerId, id, on);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.status).toBe('FAILED');
    expect(res.body.data.fields).toEqual({});
    return res.body.data;
  };

  it('reports an unreadable document as a failed result, not an error', async () => {
    const data = await failed(markedFile(JPEG, 'UNREADABLE'));
    expect(data.failureReason).toBe('UNREADABLE');
    expect(data.verdict).toEqual({ accepted: false, message: expect.stringContaining('could not read') });
  });

  it('treats a document from which nothing could be read as unreadable', async () => {
    const data = await failed(markedFile(JPEG, 'blank page'));
    expect(data).toMatchObject({ failureReason: 'UNREADABLE', model: 'fake-model-1' });
  });

  it('reports a provider that throws as PROVIDER_ERROR', async () => {
    const data = await failed(markedFile(JPEG, 'EXPLODE'));
    expect(data.failureReason).toBe('PROVIDER_ERROR');
    // A check that could not run is not the family's mistake: it never blocks them.
    expect(data.verdict).toEqual({ accepted: true, message: null });
  });

  it('stops a slow provider at the deadline', async () => {
    const quick = buildApi(db, { storage, documentExtraction: config({ timeoutMs: 100 }) });
    const data = await failed(markedFile(JPEG, 'SLOW'), quick);
    expect(data).toMatchObject({ failureReason: 'TIMEOUT', model: null });
  });

  it('does not send a file over the size limit', async () => {
    const small = buildApi(db, { storage, documentExtraction: config({ maxBytes: 1024 }) });
    const before = fake.calls.length;
    expect((await failed(fieldsFile({ firstName: 'Tai' }), small)).failureReason).toBe(
      'UNSUPPORTED',
    );
    expect(fake.calls.length).toBe(before);
  });
});

it('never logs extracted values or provider error text', async () => {
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
  const logged = buildApi(db, { logger, storage, documentExtraction: config() });
  const marker = `LOGMARKER${randomUUID().replaceAll('-', '')}`;

  const f = await family();
  const ok = await uploaded(f, fieldsFile({ firstName: marker, dateOfBirth: '2011-08-29' }));
  expect((await extract(f.ownerId, ok, logged)).body.data.fields.firstName.value).toBe(marker);
  const boom = await uploaded(f, markedFile(JPEG, 'EXPLODE'), { documentType: 'SCHOOL_ID' });
  await extract(f.ownerId, boom, logged);

  const out = lines.join('\n');
  expect(out).toContain('Document extraction');
  expect(out).toContain('"status":"SUCCEEDED"');
  expect(out).not.toContain(marker);
  expect(out).not.toContain('2011-08-29');
  expect(out).not.toContain('Mateialona');
  expect(out).not.toContain('sk-proj-ABCDEFGHIJKLMNOPQRSTUV');
});

describe('approval by the AI check', () => {
  const GOOD = { fullName: 'Casey Coach', expiryDate: '2027-06-01' };
  const COACH_DOCS = ['FIRST_AID_CPR', 'YALF_TACKLE', 'BACKGROUND_CHECK'] as const;

  const statusOf = async (id: string) =>
    (
      await db.query<{ status: string; ai_accepted: boolean }>(
        'select status, ai_accepted from public.documents where id = $1',
        [id],
      )
    ).rows[0]!;

  /** Uploads, AI-checks (as the owner) and submits one coach document. */
  async function checkedAndSubmitted(o: Owner, documentType: string, fields: Record<string, string>) {
    const id = await uploaded(o, fieldsFile(fields), { documentType });
    const res = await extract(o.ownerId, id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const sub = await as(app, o.ownerId).post(`${D}/${id}/submit`, {});
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    return id;
  }

  it('approves the documents, with no human reviewer, once every AI-readable required document was accepted', async () => {
    const c = await coach();
    const ids: string[] = [];
    for (const t of COACH_DOCS) ids.push(await checkedAndSubmitted(c, t, GOOD));
    for (const id of ids) expect(await statusOf(id)).toEqual({ status: 'APPROVED', ai_accepted: true });
    const reviews = await db.query<{ reviewer_id: string | null; automated: boolean }>(
      'select reviewer_id, automated from public.document_reviews where document_id = any($1)',
      [ids],
    );
    expect(reviews.rows).toHaveLength(3);
    expect(reviews.rows.every((r) => r.reviewer_id === null && r.automated)).toBe(true);
  });

  it('approves nothing while one required document was rejected by the AI', async () => {
    const c = await coach();
    const ids: string[] = [];
    ids.push(await checkedAndSubmitted(c, 'FIRST_AID_CPR', GOOD));
    ids.push(await checkedAndSubmitted(c, 'YALF_TACKLE', { ...GOOD, expiryDate: '2020-01-01' }));
    ids.push(await checkedAndSubmitted(c, 'BACKGROUND_CHECK', GOOD));
    for (const id of ids) expect((await statusOf(id)).status).toBe('PENDING');
    expect((await statusOf(ids[1]!)).ai_accepted).toBe(false);
  });

  it('does not trust the client: a document the API never saw accepted is not approved', async () => {
    const c = await coach();
    const ids: string[] = [];
    ids.push(await checkedAndSubmitted(c, 'FIRST_AID_CPR', GOOD));
    ids.push(await checkedAndSubmitted(c, 'YALF_TACKLE', GOOD));
    const unchecked = await uploaded(c, fieldsFile(GOOD), { documentType: 'BACKGROUND_CHECK' });
    const sub = await as(app, c.ownerId).post(`${D}/${unchecked}/submit`, {});
    expect(sub.status).toBe(200);
    for (const id of [...ids, unchecked]) expect((await statusOf(id)).status).toBe('PENDING');
  });
});
