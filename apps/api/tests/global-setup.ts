import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';
import type { TestProject } from 'vitest/node';
import { migrateUp } from '../src/infrastructure/database/migrate';

/**
 * Gives every test file a REAL PostgreSQL server (not PGlite, not a mock).
 *  - If TEST_DATABASE_URL is set it must point at a disposable PostgreSQL server whose user may create
 *    databases (e.g. a CI service container); it is used instead of the embedded server.
 *  - Otherwise an embedded PostgreSQL server (the real postgres binaries, via `embedded-postgres`) is
 *    started on a free port in a temp directory and removed afterwards. No Docker needed.
 * One database is created and migrated for the whole run; tests isolate themselves with unique data.
 * migrations.test.ts creates its own throw-away databases through `adminDatabaseUrl`.
 */
declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    adminDatabaseUrl: string;
  }
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });

function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

export default async function setup(project: TestProject) {
  let adminUrl: string;
  let stop: () => Promise<void> = async () => undefined;

  if (process.env.TEST_DATABASE_URL) {
    adminUrl = process.env.TEST_DATABASE_URL;
  } else {
    const port = await freePort();
    const pg = new EmbeddedPostgres({
      databaseDir: mkdtempSync(join(tmpdir(), 'facex-pg-')),
      user: 'postgres',
      password: 'postgres',
      port,
      persistent: false,
      onLog: () => undefined,
      onError: () => undefined,
    });
    await pg.initialise();
    await pg.start();
    stop = () => pg.stop();
    adminUrl = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  }

  const dbName = `facex_test_${Date.now()}`;
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();

  const databaseUrl = withDatabase(adminUrl, dbName);
  await migrateUp(databaseUrl);

  project.provide('databaseUrl', databaseUrl);
  project.provide('adminDatabaseUrl', adminUrl);

  return async () => {
    if (process.env.TEST_DATABASE_URL) {
      const c = new Client({ connectionString: adminUrl });
      await c.connect();
      await c.query(`drop database if exists ${dbName} with (force)`);
      await c.end();
    }
    await stop();
  };
}
