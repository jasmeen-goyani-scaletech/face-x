import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/infrastructure/database/database';
import type { Role } from '../src/modules/users';
import { bearerFor, buildGuardedApp, createUser, openTestDb, unique } from './helpers/test-app';

/**
 * Authorization (roles, organization, event access) against a REAL PostgreSQL database: the access rules
 * run their real SQL, so the registrations -> staff_profiles join is exercised, not faked.
 */
let db: Database;
let app: ReturnType<typeof buildGuardedApp>;

interface World {
  orgA: string;
  orgB: string;
  eventA: string;
  eventB: string;
  users: Record<string, string>;
}
let w: World;

async function createOrg(): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.organizations (name, slug) values ($1, $2) returning id`,
    ['Org', unique('org')],
  );
  return rows[0]!.id;
}
async function createEvent(orgId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.events (organization_id, name, location, timezone, starts_at, ends_at)
     values ($1, 'Event', 'Field', 'America/Los_Angeles', now(), now() + interval '3 hours') returning id`,
    [orgId],
  );
  return rows[0]!.id;
}
/** A coach/staff user with a profile and (optionally) a registration for an event. */
async function createPersonnel(options: {
  roles: Role[];
  profileType: 'COACH' | 'STAFF';
  orgId: string;
  eventId?: string;
  status?: string;
}): Promise<string> {
  const user = await createUser(db, { roles: options.roles, organizationId: options.orgId });
  const { rows } = await db.query<{ id: string }>(
    `insert into public.staff_profiles (user_id, profile_type, staff_role, first_name, last_name, email)
     values ($1, $2, $3, 'P', 'Q', $4) returning id`,
    [
      user.id,
      options.profileType,
      options.profileType === 'STAFF' ? 'TEAM_MANAGER' : null,
      user.email,
    ],
  );
  if (options.eventId) {
    await db.query(
      `insert into public.registrations (event_id, registrant_type, staff_profile_id, status) values ($1, $2, $3, $4)`,
      [options.eventId, options.profileType, rows[0]!.id, options.status ?? 'VERIFIED'],
    );
  }
  return user.id;
}

beforeAll(async () => {
  db = openTestDb();
  app = buildGuardedApp(db);
  const orgA = await createOrg();
  const orgB = await createOrg();
  const eventA = await createEvent(orgA);
  const eventB = await createEvent(orgB);
  const users: Record<string, string> = {};
  users.adminA = (await createUser(db, { roles: ['ADMIN'], organizationId: orgA })).id;
  users.adminB = (await createUser(db, { roles: ['ADMIN'], organizationId: orgB })).id;
  users.adminNoOrg = (await createUser(db, { roles: ['ADMIN'] })).id;
  users.adminDisabled = (
    await createUser(db, { roles: ['ADMIN'], organizationId: orgA, active: false })
  ).id;
  users.coachApproved = await createPersonnel({
    roles: ['COACH'],
    profileType: 'COACH',
    orgId: orgA,
    eventId: eventA,
    status: 'VERIFIED',
  });
  users.coachReady = await createPersonnel({
    roles: ['COACH'],
    profileType: 'COACH',
    orgId: orgA,
    eventId: eventA,
    status: 'READY_FOR_EVENT',
  });
  users.coachPending = await createPersonnel({
    roles: ['COACH'],
    profileType: 'COACH',
    orgId: orgA,
    eventId: eventA,
    status: 'SUBMITTED',
  });
  users.coachRejected = await createPersonnel({
    roles: ['COACH'],
    profileType: 'COACH',
    orgId: orgA,
    eventId: eventA,
    status: 'REJECTED',
  });
  users.coachCancelled = await createPersonnel({
    roles: ['COACH'],
    profileType: 'COACH',
    orgId: orgA,
    eventId: eventA,
    status: 'CANCELLED',
  });
  users.coachOtherEvent = await createPersonnel({
    roles: ['COACH'],
    profileType: 'COACH',
    orgId: orgA,
    eventId: eventB,
    status: 'VERIFIED',
  });
  users.coachNoRegistration = await createPersonnel({
    roles: ['COACH'],
    profileType: 'COACH',
    orgId: orgA,
  });
  // has a STAFF registration but only the COACH role: wrong registration type for the role held
  users.coachRoleStaffReg = await createPersonnel({
    roles: ['COACH'],
    profileType: 'STAFF',
    orgId: orgA,
    eventId: eventA,
    status: 'VERIFIED',
  });
  users.staffApproved = await createPersonnel({
    roles: ['STAFF'],
    profileType: 'STAFF',
    orgId: orgA,
    eventId: eventA,
    status: 'VERIFIED',
  });
  users.staffPending = await createPersonnel({
    roles: ['STAFF'],
    profileType: 'STAFF',
    orgId: orgA,
    eventId: eventA,
    status: 'DOCUMENT_REVIEW',
  });
  // an approved registration but the role was never granted
  users.registrationButNoRole = await createPersonnel({
    roles: [],
    profileType: 'COACH',
    orgId: orgA,
    eventId: eventA,
    status: 'VERIFIED',
  });
  users.multi = await createPersonnel({
    roles: ['PARENT', 'COACH'],
    profileType: 'COACH',
    orgId: orgA,
    eventId: eventA,
    status: 'VERIFIED',
  });
  users.parent = (await createUser(db, { roles: ['PARENT'], organizationId: orgA })).id;
  users.player = (await createUser(db, { roles: ['PLAYER'], organizationId: orgA })).id;
  users.noRoles = (await createUser(db, { organizationId: orgA })).id;
  w = { orgA, orgB, eventA, eventB, users };
});
afterAll(() => db.close());

const get = async (path: string, who?: string) => {
  const req = request(app).get(path);
  return who ? req.set(await bearerFor(w.users[who]!)) : req;
};
const data = (eventId: string) => `/events/${eventId}/data`;

describe('role authorization', () => {
  it('allows a user who has the role, forbids one who does not (403, not 401)', async () => {
    expect((await get('/admin-only', 'adminA')).status).toBe(200);
    for (const who of ['coachApproved', 'staffApproved', 'parent', 'player', 'noRoles']) {
      const res = await get('/admin-only', who);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
    }
  });

  it('returns 401 when unauthenticated, before any role check', async () => {
    expect((await get('/admin-only')).status).toBe(401);
  });

  it('accepts any one of several allowed roles', async () => {
    expect((await get('/coach-or-staff', 'coachApproved')).status).toBe(200);
    expect((await get('/coach-or-staff', 'staffApproved')).status).toBe(200);
    expect((await get('/coach-or-staff', 'parent')).status).toBe(403);
    expect((await get('/coach-or-staff', 'adminA')).status).toBe(403);
  });

  it('supports multiple roles for one user, through whichever role matches', async () => {
    expect((await get('/coach-or-staff', 'multi')).status).toBe(200);
    expect((await get('/admin-only', 'multi')).status).toBe(403);
  });

  it('rejects a disabled admin outright', async () => {
    const res = await get('/admin-only', 'adminDisabled');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });
});

describe('organization authorization', () => {
  it('lets an admin manage events of their own organization only', async () => {
    expect((await get(data(w.eventA), 'adminA')).body.level).toBe('ADMIN');
    expect((await get(data(w.eventB), 'adminB')).body.level).toBe('ADMIN');
    for (const [who, event] of [
      ['adminA', w.eventB],
      ['adminB', w.eventA],
    ] as const) {
      const res = await get(data(event), who);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('EVENT_ACCESS_DENIED');
    }
  });

  it('gives an admin with no organization access to nothing', async () => {
    expect((await get(data(w.eventA), 'adminNoOrg')).status).toBe(403);
  });

  it('keeps admin-only event routes closed to coaches and staff', async () => {
    expect((await get(`/events/${w.eventA}/manage`, 'adminA')).status).toBe(200);
    for (const who of ['coachApproved', 'staffApproved', 'multi']) {
      expect((await get(`/events/${w.eventA}/manage`, who)).status).toBe(403);
    }
  });
});

describe('event authorization (real registrations -> staff_profiles query)', () => {
  it('allows a coach with an approved registration for the event (VERIFIED or READY_FOR_EVENT)', async () => {
    for (const who of ['coachApproved', 'coachReady']) {
      const res = await get(data(w.eventA), who);
      expect(res.status).toBe(200);
      expect(res.body.level).toBe('PERSONNEL');
    }
  });

  it('allows an approved staff member', async () => {
    expect((await get(data(w.eventA), 'staffApproved')).status).toBe(200);
  });

  it('denies pending, rejected and cancelled registrations', async () => {
    for (const who of ['coachPending', 'coachRejected', 'coachCancelled', 'staffPending']) {
      const res = await get(data(w.eventA), who);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('EVENT_ACCESS_DENIED');
    }
  });

  it('denies the wrong event, no registration, and a registration of the wrong type', async () => {
    for (const who of ['coachOtherEvent', 'coachNoRegistration', 'coachRoleStaffReg']) {
      expect((await get(data(w.eventA), who)).status).toBe(403);
    }
    expect((await get(data(w.eventB), 'coachOtherEvent')).status).toBe(200); // their own event works
  });

  it('does not let the COACH role alone, or a registration alone, grant access', async () => {
    expect((await get(data(w.eventA), 'coachNoRegistration')).status).toBe(403); // role, no registration
    expect((await get(data(w.eventA), 'registrationButNoRole')).status).toBe(403); // registration, no role
  });

  it('grants a multi-role user access through the role/registration that qualifies', async () => {
    expect((await get(data(w.eventA), 'multi')).status).toBe(200);
    expect((await get(data(w.eventB), 'multi')).status).toBe(403);
  });

  it('gives parents, players and role-less users no event-level access (ownership-based access comes with their own modules)', async () => {
    for (const who of ['parent', 'player', 'noRoles']) {
      expect((await get(data(w.eventA), who)).status).toBe(403);
    }
  });

  it('returns 404 for an unknown event, 422 for a malformed id, and never a server error for injection', async () => {
    const missing = await get(data(randomUUID()), 'adminA');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('EVENT_NOT_FOUND');
    for (const bad of [
      'not-a-uuid',
      encodeURIComponent("1' OR '1'='1"),
      encodeURIComponent('1; DROP TABLE public.users;--'),
    ]) {
      expect((await get(data(bad), 'adminA')).status).toBe(422);
    }
    const { rows } = await db.query('select 1 from public.users limit 1');
    expect(rows).toHaveLength(1);
  });

  it('requires authentication first', async () => {
    expect((await get(data(w.eventA))).status).toBe(401);
  });

  it('reflects registration changes immediately (nothing is cached in the token)', async () => {
    const userId = w.users.coachPending!;
    expect((await get(data(w.eventA), 'coachPending')).status).toBe(403);
    await db.query(
      `update public.registrations set status = 'VERIFIED' where staff_profile_id in (select id from public.staff_profiles where user_id = $1)`,
      [userId],
    );
    expect((await get(data(w.eventA), 'coachPending')).status).toBe(200);
    await db.query(
      `update public.registrations set status = 'CANCELLED' where staff_profile_id in (select id from public.staff_profiles where user_id = $1)`,
      [userId],
    );
    expect((await get(data(w.eventA), 'coachPending')).status).toBe(403);
  });
});
