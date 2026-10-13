import { inject } from 'vitest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDatabase,
  isUniqueViolation,
  type Database,
} from '../src/infrastructure/database/database';
import { createUserRepository } from '../src/modules/users';
import { createUser, openTestDb, uniqueEmail } from './helpers/test-app';

/** All of these run against a real PostgreSQL server (see global-setup.ts). */
let db: Database;
beforeAll(() => {
  db = openTestDb();
});
afterAll(() => db.close());

describe('PostgreSQL connection', () => {
  it('connects to a real PostgreSQL server and reports its version', async () => {
    const { rows } = await db.query<{ version: string }>('select version()');
    expect(rows[0]?.version).toMatch(/^PostgreSQL \d+/);
  });

  it('has every migrated table and no Supabase-specific schema', async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    const names = rows.map((r) => r.table_name);
    for (const t of [
      'users',
      'user_roles',
      'user_credentials',
      'refresh_tokens',
      'registrations',
      'check_ins',
      'audit_logs',
    ]) {
      expect(names).toContain(t);
    }
    const { rows: schemas } = await db.query<{ schema_name: string }>(
      `select schema_name from information_schema.schemata where schema_name in ('auth', 'storage')`,
    );
    expect(schemas).toEqual([]);
  });

  it('fails clearly for an unreachable server', async () => {
    const bad = createDatabase({ url: 'postgres://u:p@127.0.0.1:1/none' });
    await expect(bad.query('select 1')).rejects.toThrow();
    await bad.close();
  });

  it('exposes the configured URL only through the test context', () => {
    expect(inject('databaseUrl')).toMatch(/^postgres:\/\//);
  });
});

describe('transactions', () => {
  it('commits when the callback resolves', async () => {
    const email = uniqueEmail('tx-commit');
    await db.transaction(async (tx) => {
      await tx.query('insert into public.users (email) values ($1)', [email]);
    });
    expect(await createUserRepository(db).findByEmail(email)).not.toBeNull();
  });

  it('rolls back everything when the callback throws', async () => {
    const email = uniqueEmail('tx-rollback');
    await expect(
      db.transaction(async (tx) => {
        await tx.query('insert into public.users (email) values ($1)', [email]);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await createUserRepository(db).findByEmail(email)).toBeNull();
  });

  it('detects unique violations', async () => {
    const email = uniqueEmail('dup');
    await db.query('insert into public.users (email) values ($1)', [email]);
    const err = await db
      .query('insert into public.users (email) values ($1)', [email])
      .catch((e) => e);
    expect(isUniqueViolation(err)).toBe(true);
    expect(isUniqueViolation(err, 'users_email_key')).toBe(true);
    expect(isUniqueViolation(err, 'other_constraint')).toBe(false);
  });
});

describe('SQL injection protection', () => {
  const hostile = [
    "x' OR '1'='1",
    "'; DROP TABLE public.users; --",
    "x\\'; delete from public.users where '1'='1",
    'x" OR ""="',
  ];

  it('treats hostile input as plain data in lookups', async () => {
    await createUser(db); // make sure the table has rows
    const repo = createUserRepository(db);
    for (const input of hostile) {
      expect(await repo.findByEmail(input)).toBeNull();
      expect(await repo.findRoles(input).catch((e: Error) => e.message)).toMatch(/uuid/);
    }
    const { rows } = await db.query<{ n: number }>('select count(*)::int as n from public.users');
    expect(rows[0]!.n).toBeGreaterThan(0); // nothing was dropped or deleted
  });

  it('stores hostile input literally instead of executing it', async () => {
    const email = `o'brien'; drop table x;--${Date.now()}@example.com`;
    await db.query('insert into public.users (email, full_name) values ($1, $2)', [
      email,
      "Robert'); DROP TABLE public.users;--",
    ]);
    const found = await createUserRepository(db).findByEmail(email);
    expect(found?.fullName).toBe("Robert'); DROP TABLE public.users;--");
  });
});
