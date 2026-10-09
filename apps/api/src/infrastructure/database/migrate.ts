import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runner } from 'node-pg-migrate';
import { Client } from 'pg';

/** Plain-SQL migrations live in apps/api/db (one level above src/ and dist/). */
export const DB_DIR = join(__dirname, '..', '..', '..', 'db');
export const MIGRATIONS_DIR = join(DB_DIR, 'migrations');
export const SEED_FILE = join(DB_DIR, 'seed.sql');

/** Applies pending migrations (idempotent; takes a Postgres advisory lock so concurrent runs are safe). */
export async function migrateUp(databaseUrl: string): Promise<string[]> {
  const applied = await runner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    log: () => undefined,
  });
  return applied.map((m) => m.name);
}

/** Loads the development seed. Never run against production. */
export async function runSeed(databaseUrl: string): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(readFileSync(SEED_FILE, 'utf8'));
  } finally {
    await client.end();
  }
}
