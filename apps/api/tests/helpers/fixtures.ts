import request from 'supertest';
import type { Express } from 'express';
import type { Database } from '../../src/infrastructure/database/database';
import { bearerFor, unique } from './test-app';

export async function createOrg(db: Database): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.organizations (name, slug) values ('Org', $1) returning id`,
    [unique('org')],
  );
  return rows[0]!.id;
}

export async function createEvent(
  db: Database,
  orgId: string,
  options: {
    status?: 'DRAFT' | 'PUBLISHED' | 'CLOSED';
    feeCents?: number;
    startsAt?: Date;
    timezone?: string;
  } = {},
): Promise<string> {
  const startsAt = options.startsAt ?? new Date(Date.now() + 30 * 86_400_000);
  const { rows } = await db.query<{ id: string }>(
    `insert into public.events (organization_id, name, location, timezone, starts_at, ends_at, registration_fee_cents, status)
     values ($1, 'Event', 'Field', $2, $3, $3::timestamptz + interval '3 hours', $4, $5) returning id`,
    [
      orgId,
      options.timezone ?? 'America/Los_Angeles',
      startsAt,
      options.feeCents ?? 9500,
      options.status ?? 'PUBLISHED',
    ],
  );
  return rows[0]!.id;
}

export async function createTeam(
  db: Database,
  eventId: string,
  options: { status?: 'ACTIVE' | 'DISABLED' } = {},
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.teams (event_id, name, club, division, status) values ($1, $2, 'Club', 'U12', $3) returning id`,
    [eventId, unique('team'), options.status ?? 'ACTIVE'],
  );
  return rows[0]!.id;
}

export const childBody = (overrides: Record<string, unknown> = {}) => ({
  firstName: 'Mateo',
  lastName: 'Rivera',
  dateOfBirth: '2014-03-09',
  ageDivision: 'U12',
  guardian: {
    relationship: 'Mother',
    firstName: 'Dana',
    lastName: 'Rivera',
    phone: '555-019-2831',
  },
  ...overrides,
});

/** Authenticated request helpers: send as a given user id. */
export function as(app: Express, userId: string) {
  const call = async (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    body?: unknown,
  ) => {
    const req = request(app)
      [method](path)
      .set(await bearerFor(userId));
    return body === undefined ? req : req.send(body as object);
  };
  return {
    get: (path: string) => call('get', path),
    post: (path: string, body?: unknown) => call('post', path, body ?? {}),
    patch: (path: string, body: unknown) => call('patch', path, body),
    delete: (path: string) => call('delete', path),
  };
}

/** Creates a child through the API (as the parent) and returns the player id. */
export async function createChild(
  app: Express,
  parentUserId: string,
  overrides: Record<string, unknown> = {},
) {
  const res = await as(app, parentUserId).post('/api/v1/players', childBody(overrides));
  if (res.status !== 201)
    throw new Error(`createChild failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.id as string;
}

/**
 * Removes the real guardian wording (GUARDIAN_CONSENT v2, published by a migration) from a test's own throw-away database.
 * Consent tests publish their own versions starting at 1 and assert on exactly which one is current, which the migrated
 * wording would otherwise shadow. The immutability trigger is switched off for just this delete, inside one transaction.
 */
export async function dropMigratedGuardianConsent(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query('alter table public.consents disable trigger consents_freeze_content');
    await tx.query("delete from public.consents where code = 'GUARDIAN_CONSENT' and version = 2");
    await tx.query('alter table public.consents enable trigger consents_freeze_content');
  });
}
