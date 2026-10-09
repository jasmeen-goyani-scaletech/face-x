import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/infrastructure/database/database';
import { buildApi, openTestDb } from './helpers/test-app';

let db: Database;
beforeAll(() => {
  db = openTestDb();
});
afterAll(() => db.close());

describe('GET /health', () => {
  it('reports liveness and sets secure headers', async () => {
    const res = await request(buildApi(db)).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { status: 'ok' } });
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('GET /health/ready', () => {
  it('is ok against the real PostgreSQL database', async () => {
    const res = await request(buildApi(db)).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.data.checks.database).toBe('ok');
  });

  it('returns 503 without leaking details when the database is down', async () => {
    // A stand-in Database that fails (this one case is a stub, not real PostgreSQL).
    const broken: Database = {
      query: async () => {
        throw new Error('connect ECONNREFUSED 10.0.0.1:5432 secret-host');
      },
      transaction: async () => {
        throw new Error('down');
      },
      close: async () => undefined,
    };
    const res = await request(buildApi(broken)).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'DATABASE_UNAVAILABLE', message: 'Database is not reachable' },
    });
  });
});

describe('error handling', () => {
  it('returns the standard envelope for unknown routes', async () => {
    const res = await request(buildApi(db)).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('returns 400 INVALID_JSON for malformed bodies', async () => {
    const res = await request(buildApi(db))
      .post('/health')
      .set('Content-Type', 'application/json')
      .send('{not json');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });
});
