import { readdirSync } from 'node:fs';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '../src/infrastructure/database/database';
import { MIGRATIONS_DIR, migrateUp, runSeed } from '../src/infrastructure/database/migrate';

/**
 * Applies the migrations and the dev seed to a FRESH database on a real PostgreSQL server, then checks the
 * schema's own guarantees (constraints, triggers, indexes). Nothing is mocked or emulated.
 */
let db: Database;
let appliedFirstRun: string[];
let appliedSecondRun: string[];
let adminUrl: string;
const dbName = `facex_migr_${Date.now()}`;

const STAFF = '00000000-0000-4000-8000-0000000000aa';
const COACH_USER = '00000000-0000-4000-8000-0000000000ab';
const ids = {
  org: '00000000-0000-4000-8000-000000000001',
  event: '00000000-0000-4000-8000-000000000010',
  otherEvent: '00000000-0000-4000-8000-000000000011',
  team: '00000000-0000-4000-8000-000000000020',
  otherTeam: '00000000-0000-4000-8000-000000000022',
  player: '00000000-0000-4000-8000-000000000050',
  regDraft: '00000000-0000-4000-8000-000000000060',
  regSubmitted: '00000000-0000-4000-8000-000000000061',
  coachProfile: '00000000-0000-4000-8000-0000000000c1',
};

/** Runs a statement that must fail and returns the database's error message. */
async function rejects(sql: string, params: unknown[] = []): Promise<string> {
  try {
    await db.query(sql, params);
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error(`Expected statement to fail: ${sql}`);
}
const msgOf = (p: Promise<unknown>) =>
  p.then(
    () => '',
    (e: Error) => e.message,
  );

beforeAll(async () => {
  adminUrl = inject('adminDatabaseUrl');
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  const dbUrl = u.toString();

  appliedFirstRun = await migrateUp(dbUrl);
  appliedSecondRun = await migrateUp(dbUrl);
  await runSeed(dbUrl);
  db = createDatabase({ url: dbUrl });

  await db.query(
    `insert into public.users (id, email) values ($1, 'staff@example.com'), ($2, 'coach@example.com')`,
    [STAFF, COACH_USER],
  );
  await db.query(
    `insert into public.user_roles (user_id, role) values ($1, 'STAFF'), ($2, 'COACH')`,
    [STAFF, COACH_USER],
  );
  await db.query(
    `insert into public.events (id, organization_id, name, location, timezone, starts_at, ends_at)
     values ($1, $2, 'Other', 'X', 'America/Chicago', now(), now())`,
    [ids.otherEvent, ids.org],
  );
  await db.query(
    `insert into public.teams (id, event_id, name, division) values ($1, $2, 'Elsewhere', 'U12')`,
    [ids.otherTeam, ids.otherEvent],
  );
  await db.query(
    `insert into public.staff_profiles (id, user_id, profile_type, first_name, last_name, email)
     values ($1, $2, 'COACH', 'Sam', 'Coach', 'coach@example.com')`,
    [ids.coachProfile, COACH_USER],
  );
});

afterAll(async () => {
  await db.close();
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.end();
});

describe('migration runner', () => {
  it('applies every migration file once, in order, and is idempotent', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
    expect(files.length).toBeGreaterThanOrEqual(7);
    expect(appliedFirstRun).toHaveLength(files.length);
    expect(appliedFirstRun).toEqual([...appliedFirstRun].sort());
    expect(appliedSecondRun).toEqual([]);
  });

  it('contains no Supabase-specific objects', async () => {
    const { rows: schemas } = await db.query(
      `select 1 from information_schema.schemata where schema_name in ('auth', 'storage')`,
    );
    expect(schemas).toEqual([]);
    const { rows: policies } = await db.query(
      `select 1 from pg_policies where schemaname = 'public'`,
    );
    expect(policies).toEqual([]);
    const { rows: roles } = await db.query(
      `select rolname from pg_roles where rolname in ('anon', 'authenticated', 'service_role')`,
    );
    expect(roles).toEqual([]);
  });
});

describe('schema', () => {
  it('creates every required table plus the auth tables', async () => {
    const expected = [
      'organizations',
      'users',
      'user_roles',
      'user_credentials',
      'refresh_tokens',
      'events',
      'teams',
      'players',
      'parents',
      'player_parents',
      'staff_profiles',
      'registrations',
      'registration_status_history',
      'documents',
      'document_reviews',
      'consents',
      'consent_records',
      'payments',
      'face_profiles',
      'face_scans',
      'check_ins',
      'audit_logs',
    ];
    const { rows } = await db.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public'`,
    );
    const actual = rows.map((r) => r.tablename);
    for (const table of expected) expect(actual).toContain(table);
  });

  it('keeps credentials out of public.users', async () => {
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'users'`,
    );
    const bad = rows.map((r) => r.column_name).filter((c) => /pass|secret|token|hash/i.test(c));
    expect(bad).toEqual([]);
  });

  it('seeds a guardian shared by two children and marks consents as placeholders', async () => {
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.player_parents group by parent_id`,
    );
    expect(rows[0]?.n).toBe(2);
    const { rows: consents } = await db.query<{ title: string; body: string }>(
      'select title, body from public.consents',
    );
    expect(consents.length).toBeGreaterThan(0);
    // The face-scan consent carries the approved wording (published by a migration, which also runs in production): it is the one
    // consent that is not a placeholder. Every other consent here is.
    const placeholders = consents.filter((c) => !c.title.startsWith('Face-scan'));
    expect(placeholders.length).toBeGreaterThan(0);
    for (const c of placeholders) {
      expect(c.title).toContain('DEV PLACEHOLDER');
      expect(c.body).toContain('NOT LEGAL TEXT');
    }
    const bio = consents.find((c) => c.title.startsWith('Face-scan'));
    expect(bio?.body).toMatch(
      /^I consent to the collection, extraction, and secure storage of biometric face templates/,
    );
    expect(bio?.body).not.toContain('PLACEHOLDER');
  });

  it('keeps functions on a fixed search_path', async () => {
    const { rows } = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and (p.proconfig is null or not p.proconfig::text like '%search_path%')`,
    );
    expect(rows).toEqual([]);
  });
});

describe('auth tables', () => {
  it('requires an argon2id hash', async () => {
    const msg = await rejects(
      `insert into public.user_credentials (user_id, password_hash) values ($1, 'plaintext')`,
      [STAFF],
    );
    expect(msg).toMatch(/user_credentials_password_hash_check/);
  });

  it('keeps refresh-token hashes unique and revocation fields consistent', async () => {
    const insert = (hash: string) =>
      db.query(
        `insert into public.refresh_tokens (user_id, family_id, token_hash, expires_at)
         values ($1, gen_random_uuid(), $2, now() + interval '1 day')`,
        [STAFF, hash],
      );
    await insert('hash-1');
    expect(await msgOf(insert('hash-1'))).toMatch(/token_hash_key/);
    const msg = await rejects(
      `insert into public.refresh_tokens (user_id, family_id, token_hash, expires_at, revoked_at)
       values ($1, gen_random_uuid(), 'hash-2', now() + interval '1 day', now())`,
      [STAFF],
    );
    expect(msg).toMatch(/refresh_tokens_check/);
  });
});

describe('identity and roles', () => {
  it('lets one user hold several roles but not the same one twice', async () => {
    await db.query(`insert into public.user_roles (user_id, role) values ($1, 'PARENT')`, [
      COACH_USER,
    ]);
    expect(
      await rejects(`insert into public.user_roles (user_id, role) values ($1, 'PARENT')`, [
        COACH_USER,
      ]),
    ).toMatch(/user_roles_pkey/);
    expect(
      await rejects(`insert into public.user_roles (user_id, role) values ($1, 'OWNER')`, [
        COACH_USER,
      ]),
    ).toMatch(/user_roles_role_check/);
  });

  it('requires an explicit event timezone', async () => {
    const msg = await rejects(
      `insert into public.events (organization_id, name, location, starts_at, ends_at)
       values ($1, 'No tz', 'X', now(), now())`,
      [ids.org],
    );
    expect(msg).toMatch(/timezone/);
  });
});

describe('staff_profiles (coach / staff)', () => {
  const insert = (type: string, role: string | null) =>
    db.query(
      `insert into public.staff_profiles (user_id, profile_type, staff_role, first_name, last_name, email)
       values ($1, $2, $3, 'A', 'B', 'a@example.com')`,
      [STAFF, type, role],
    );

  it('requires staff_role for STAFF and forbids it for COACH', async () => {
    expect(await msgOf(insert('STAFF', null))).toMatch(/staff_profiles_check/);
    expect(await msgOf(insert('COACH', 'TEAM_MANAGER'))).toMatch(/staff_profiles_check/);
  });

  it('allows one profile of each type per user', async () => {
    await insert('STAFF', 'TEAM_MANAGER');
    expect(await msgOf(insert('STAFF', 'SAFETY_OFFICER'))).toMatch(
      /staff_profiles_user_id_profile_type_key/,
    );
  });

  it('lets a team reference its coach', async () => {
    await db.query(`update public.teams set coach_profile_id = $1 where id = $2`, [
      ids.coachProfile,
      ids.team,
    ]);
  });
});

describe('registrations', () => {
  it('prevents the same player registering twice for an event', async () => {
    const msg = await rejects(
      `insert into public.registrations (event_id, registrant_type, player_id) values ($1, 'PLAYER', $2)`,
      [ids.event, ids.player],
    );
    expect(msg).toMatch(/registrations_event_id_player_id_key/);
  });

  it('supports coach registrations and prevents a duplicate', async () => {
    const insert = () =>
      db.query(
        `insert into public.registrations (event_id, registrant_type, staff_profile_id) values ($1, 'COACH', $2)`,
        [ids.event, ids.coachProfile],
      );
    await insert();
    expect(await msgOf(insert())).toMatch(/registrations_event_id_staff_profile_id_key/);
  });

  it('requires exactly one registrant matching registrant_type', async () => {
    const attempts: [string, unknown[]][] = [
      [
        `insert into public.registrations (event_id, registrant_type) values ($1, 'PLAYER')`,
        [ids.event],
      ],
      [
        `insert into public.registrations (event_id, registrant_type, player_id) values ($1, 'COACH', $2)`,
        [ids.event, ids.player],
      ],
      [
        `insert into public.registrations (event_id, registrant_type, player_id, staff_profile_id)
         values ($1, 'PLAYER', $2, $3)`,
        [ids.event, ids.player, ids.coachProfile],
      ],
    ];
    for (const [sql, params] of attempts) {
      expect(await rejects(sql, params)).toMatch(/registrations_check/);
    }
  });

  it('rejects an invalid status and a team from a different event', async () => {
    expect(
      await rejects(`update public.registrations set status = 'PAID' where id = $1`, [
        ids.regDraft,
      ]),
    ).toMatch(/registrations_status_check/);
    expect(
      await rejects(`update public.registrations set team_id = $1 where id = $2`, [
        ids.otherTeam,
        ids.regDraft,
      ]),
    ).toMatch(/foreign key/);
  });

  it('generates a readable registration number', async () => {
    const { rows } = await db.query<{ registration_number: string }>(
      `select registration_number from public.registrations where id = $1`,
      [ids.regDraft],
    );
    expect(rows[0]?.registration_number).toMatch(/^FX-\d{4}-\d{5}$/);
  });

  it('keeps status history append-only', async () => {
    expect(await rejects(`delete from public.registration_status_history`)).toMatch(/append-only/);
  });
});

describe('check-ins', () => {
  const insertCheckIn = (registrationId: string, eventId = ids.event) =>
    db.query(
      `insert into public.check_ins (event_id, registration_id, method, checked_in_by)
       values ($1, $2, 'MANUAL', $3)`,
      [eventId, registrationId, STAFF],
    );
  const setStatus = (status: string, id = ids.regDraft) =>
    db.query(`update public.registrations set status = $1 where id = $2`, [status, id]);

  it('refuses every status except READY_FOR_EVENT', async () => {
    for (const status of [
      'DRAFT',
      'SUBMITTED',
      'PAYMENT_PENDING',
      'PAYMENT_COMPLETED',
      'DOCUMENT_REVIEW',
      'VERIFIED',
      'REJECTED',
      'CANCELLED',
    ]) {
      await setStatus(status);
      expect(await msgOf(insertCheckIn(ids.regDraft))).toMatch(/not eligible for check-in/);
    }
  });

  it('refuses a registration that belongs to another event', async () => {
    await setStatus('READY_FOR_EVENT');
    expect(await msgOf(insertCheckIn(ids.regDraft, ids.otherEvent))).toMatch(/foreign key/);
  });

  it('refuses a READY registration while event-day access is disabled', async () => {
    await db.query(
      `update public.registrations set event_access_disabled = true, event_access_disabled_reason = 'admin' where id = $1`,
      [ids.regDraft],
    );
    expect(await msgOf(insertCheckIn(ids.regDraft))).toMatch(/access is disabled/);
    await db.query(`update public.registrations set event_access_disabled = false where id = $1`, [
      ids.regDraft,
    ]);
  });

  it('allows one check-in and rejects the duplicate, including two truly concurrent attempts', async () => {
    // The pool gives each call its own connection, so these genuinely race inside PostgreSQL.
    const results = await Promise.allSettled([
      insertCheckIn(ids.regDraft),
      insertCheckIn(ids.regDraft),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(String(failure.reason)).toMatch(/check_ins_registration_id_key/);
  });

  it('checks a coach in the same way, and a FACE check-in needs a face scan', async () => {
    const { rows } = await db.query<{ id: string }>(
      `select id from public.registrations where staff_profile_id = $1`,
      [ids.coachProfile],
    );
    await setStatus('READY_FOR_EVENT', rows[0]!.id);
    await insertCheckIn(rows[0]!.id);
    const msg = await rejects(
      `insert into public.check_ins (event_id, registration_id, method, checked_in_by)
       values ($1, $2, 'FACE', $3)`,
      [ids.event, ids.regDraft, STAFF],
    );
    expect(msg).toMatch(/check_ins_check/);
  });
});

describe('payments', () => {
  const insertPayment = (status: string) =>
    db.query(
      `insert into public.payments (registration_id, status, amount_cents, paid_at, stripe_checkout_session_id)
       values ($1, $2, 9500, case when $2 = 'PAID' then now() end, case when $2 = 'PAID' then 'cs_' || gen_random_uuid()::text end)`,
      [ids.regDraft, status],
    );

  it('allows one open attempt and one PAID per registration, no more', async () => {
    await insertPayment('FAILED');
    await insertPayment('PAYMENT_PENDING');
    expect(await msgOf(insertPayment('PAYMENT_PENDING'))).toMatch(/one_pending/);
    await insertPayment('PAID');
    expect(await msgOf(insertPayment('PAID'))).toMatch(/one_paid/);
  });

  it('rejects PAID without paid_at', async () => {
    const msg = await rejects(
      `insert into public.payments (registration_id, status, amount_cents) values ($1, 'PAID', 9500)`,
      [ids.regSubmitted],
    );
    expect(msg).toMatch(/payments_check/);
  });
});

describe('documents, consent, face, audit', () => {
  const insertDoc = (type: string, key: string) =>
    db.query<{ id: string }>(
      `insert into public.documents (registration_id, document_type, storage_key, file_name, mime_type)
       values ($1, $2, $3, 'f.pdf', 'application/pdf') returning id`,
      [ids.regDraft, type, key],
    );

  it('stores only a unique storage key (metadata), for player and coach/staff document types', async () => {
    await insertDoc('SAFESPORT', 'registration-documents/a/b');
    expect(await msgOf(insertDoc('FIRST_AID_CPR', 'registration-documents/a/b'))).toMatch(
      /storage_key_key/,
    );
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'documents'`,
    );
    const columns = rows.map((r) => r.column_name);
    expect(columns).toContain('storage_key');
    for (const forbidden of ['content', 'data', 'bytes', 'storage_bucket']) {
      expect(columns).not.toContain(forbidden);
    }
  });

  it('requires a reason when a document review rejects', async () => {
    const { rows } = await insertDoc('BIRTH_CERTIFICATE', 'registration-documents/a/c');
    const msg = await rejects(
      `insert into public.document_reviews (document_id, reviewer_id, decision) values ($1, $2, 'REJECTED')`,
      [rows[0]!.id, STAFF],
    );
    expect(msg).toMatch(/document_reviews_check/);
  });

  it('allows only one live document per type, but a rejected one can be replaced', async () => {
    expect(await msgOf(insertDoc('BIRTH_CERTIFICATE', 'registration-documents/a/d'))).toMatch(
      /one_live_per_type/,
    );
    await db.query(
      `update public.documents set status = 'REJECTED', uploaded_at = now(), submitted_at = now() where registration_id = $1 and document_type = 'BIRTH_CERTIFICATE'`,
      [ids.regDraft],
    );
    await insertDoc('BIRTH_CERTIFICATE', 'registration-documents/a/e');
  });

  it('freezes consent text and keeps consent records append-only', async () => {
    expect(await rejects(`update public.consents set body = 'changed'`)).toMatch(/immutable/);
    await db.query(
      `insert into public.consent_records (consent_id, registration_id, accepted_by_parent_id, signed_name, ip_address, user_agent)
       values ('00000000-0000-4000-8000-000000000030', $1, '00000000-0000-4000-8000-000000000040', 'Dana Rivera', '203.0.113.7', 'test')`,
      [ids.regDraft],
    );
    expect(await rejects(`delete from public.consent_records`)).toMatch(/append-only/);
  });

  it('keeps audit logs append-only', async () => {
    await db.query(
      `insert into public.audit_logs (actor_user_id, action, entity_type, entity_id) values ($1, 'PLAYER_CREATED', 'player', $2)`,
      [STAFF, ids.player],
    );
    expect(await rejects(`update public.audit_logs set action = 'X'`)).toMatch(/append-only/);
  });

  it('face profiles belong to exactly one person and only one is active', async () => {
    const insert = (playerId: string | null, staffId: string | null, providerId: string) =>
      db.query(
        `insert into public.face_profiles (player_id, staff_profile_id, provider, provider_profile_id)
         values ($1, $2, 'mock', $3)`,
        [playerId, staffId, providerId],
      );
    await insert(ids.player, null, 'p-1');
    expect(await msgOf(insert(ids.player, null, 'p-2'))).toMatch(/one_active_player/);
    await insert(null, ids.coachProfile, 'c-1');
    expect(await msgOf(insert(null, ids.coachProfile, 'c-2'))).toMatch(/one_active_staff/);
    expect(await msgOf(insert(null, null, 'x-1'))).toMatch(/face_profiles_check/);
    expect(await msgOf(insert(ids.player, ids.coachProfile, 'x-2'))).toMatch(/face_profiles_check/);
  });

  it('a MATCH scan must name the matched person', async () => {
    const msg = await rejects(
      `insert into public.face_scans (event_id, scanned_by, result, provider) values ($1, $2, 'MATCH', 'mock')`,
      [ids.event, STAFF],
    );
    expect(msg).toMatch(/face_scans_check/);
  });
});
