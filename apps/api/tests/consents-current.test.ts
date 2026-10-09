import request from 'supertest';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '../src/infrastructure/database/database';
import { migrateUp } from '../src/infrastructure/database/migrate';
import { as } from './helpers/fixtures';
import { buildApi, createUser } from './helpers/test-app';

/**
 * GET /consents/current: the wording a family would accept now, readable before a registration exists.
 * Consent rows are global (not per registration) and other test files publish their own, so this file works on its
 * OWN throw-away database: that is what lets it assert exactly which versions are current.
 */
let db: Database;
let app: ReturnType<typeof buildApi>;
let viewer: string;
const dbName = `facex_consents_current_${Date.now()}`;
const adminUrl = () => inject('adminDatabaseUrl');

const withDb = (url: string, name: string) => {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
};

const publish = (version: number, body: string, when: string) =>
  db.query(
    `insert into public.consents (code, version, title, body, effective_at)
     values ('GUARDIAN_CONSENT', $1, $2, $3, ${when}) returning id`,
    [version, `Guardian consent v${version}`, body],
  );

beforeAll(async () => {
  const admin = new Client({ connectionString: adminUrl() });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();
  const url = withDb(adminUrl(), dbName);
  await migrateUp(url);
  db = createDatabase({ url });
  app = buildApi(db);
  viewer = (await createUser(db)).id; // no role: reference data for any signed-in account
});

afterAll(async () => {
  await db.close();
  const admin = new Client({ connectionString: adminUrl() });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.end();
});

const current = async () =>
  (await as(app, viewer).get('/api/v1/consents/current')).body.data as {
    id: string;
    code: string;
    version: number;
    title: string;
    body: string;
    effectiveAt: string;
  }[];

describe('GET /consents/current', () => {
  it('needs a signed-in user', async () => {
    expect((await request(app).get('/api/v1/consents/current')).status).toBe(401);
  });

  it('is an empty list while nothing is published (the form must not invent wording)', async () => {
    const res = await as(app, viewer).get('/api/v1/consents/current');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('returns the published guardian consent with its exact wording', async () => {
    const { rows } = await publish(1, '[TEST v1 - not legal wording]', `now() - interval '1 day'`);
    expect(await current()).toEqual([
      expect.objectContaining({
        id: rows[0]!.id,
        code: 'GUARDIAN_CONSENT',
        version: 1,
        title: 'Guardian consent v1',
        body: '[TEST v1 - not legal wording]',
        effectiveAt: expect.any(String),
      }),
    ]);
  });

  it('ignores a version that is not effective yet', async () => {
    await publish(2, '[TEST FUTURE v2]', `now() + interval '30 days'`);
    const list = await current();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ version: 1 });
    expect(JSON.stringify(list)).not.toContain('[TEST FUTURE v2]');
  });

  it('switches to a newer version once it is effective, and lists one entry per consent', async () => {
    await publish(3, '[TEST v3]', `now() - interval '1 minute'`);
    const list = await current();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ code: 'GUARDIAN_CONSENT', version: 3, body: '[TEST v3]' });
  });

  it('only lists consents a registration can need (guardian and AB 506; no biometric consent)', async () => {
    await db.query(
      `insert into public.consents (code, version, title, body, effective_at)
       values ('AB506_ACKNOWLEDGEMENT', 1, 'AB 506', '[TEST AB506]', now() - interval '1 day'),
              ('BIOMETRIC_CONSENT', 1, 'Biometric', '[TEST BIO]', now() - interval '1 day')`,
    );
    const codes = (await current()).map((c) => c.code).sort();
    expect(codes).toEqual(['AB506_ACKNOWLEDGEMENT', 'GUARDIAN_CONSENT']);
  });
});
