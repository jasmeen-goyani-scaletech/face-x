import { Pool, type QueryResult, type QueryResultRow } from 'pg';

/** Anything that can run a parameterized query: the pool, or a client inside a transaction. */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<R>>;
}

export interface Database extends Queryable {
  /** Runs `fn` in one transaction: commit if it resolves, roll back if it throws. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface DatabaseConfig {
  url: string;
  ssl?: boolean;
  /** CA certificate (PEM text) to trust when `ssl` is on; the server certificate is always verified. */
  sslCa?: string;
  poolMax?: number;
  onError?: (err: Error) => void;
}

/**
 * The only place that talks to the `pg` driver. Repositories receive a Database and write SQL with `$1`
 * placeholders; values are never concatenated into query text.
 */
export function createDatabase(config: DatabaseConfig): Database {
  const pool = new Pool({
    connectionString: config.url,
    max: config.poolMax ?? 10,
    ssl: config.ssl
      ? { rejectUnauthorized: true, ...(config.sslCa ? { ca: config.sslCa } : {}) }
      : undefined,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 15_000,
  });
  // An idle client erroring (e.g. the server restarting) must not crash the process.
  pool.on('error', (err) => config.onError?.(err));

  return {
    query: (text, values) => pool.query(text, values as unknown[] | undefined),

    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await fn({
          query: (text, values) => client.query(text, values as unknown[] | undefined),
        });
        await client.query('commit');
        return result;
      } catch (err) {
        await client.query('rollback').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },

    close: () => pool.end(),
  };
}

/** Postgres unique-violation SQLSTATE, optionally for one named constraint/index. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string } | null;
  return e?.code === '23505' && (constraint === undefined || e.constraint === constraint);
}
