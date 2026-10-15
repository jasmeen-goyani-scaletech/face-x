import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/infrastructure/database/database';
import { MIGRATIONS_DIR } from '../src/infrastructure/database/migrate';
import { createEvent, createOrg, createTeam } from './helpers/fixtures';
import { createUser, openTestDb } from './helpers/test-app';

/**
 * 20261016000001 turns the existing team ownership (teams.coach_profile_id) and the team on each coach/staff registration
 * into team_assignments, so nobody loses the team they already have. The test seeds that legacy shape and runs the
 * migration's own backfill statements (taken from the file, not copied here) against it.
 */
let db: Database;

beforeAll(() => {
  db = openTestDb();
});
afterAll(() => db.close());

const backfill = readFileSync(
  join(MIGRATIONS_DIR, '20261016000001_team_assignments_and_registration_limits.sql'),
  'utf8',
)
  .split(';')
  .map((s) => s.trim())
  .filter((s) => /^(--[^\n]*\n)*\s*insert into public\.team_assignments/i.test(s));

async function profile(kind: 'COACH' | 'STAFF') {
  const user = await createUser(db, { roles: [kind] });
  const { rows } = await db.query<{ id: string }>(
    `insert into public.staff_profiles (user_id, profile_type, staff_role, first_name, last_name, email)
     values ($1, $2, $3, 'Pat', 'Person', $4) returning id`,
    [user.id, kind, kind === 'STAFF' ? 'TEAM_MANAGER' : null, user.email],
  );
  return rows[0]!.id;
}

describe('team_assignments backfill', () => {
  it('has the two backfill statements', () => {
    expect(backfill).toHaveLength(2);
  });

  it('keeps every existing coach-owned team and registration team, and can be run twice', async () => {
    const org = await createOrg(db);
    const event = await createEvent(db, org, { feeCents: 0 });
    const owned = await createTeam(db, event);
    const joined = await createTeam(db, event);
    const untouched = await createTeam(db, event);

    const coach = await profile('COACH');
    const staff = await profile('STAFF');
    await db.query('update public.teams set coach_profile_id = $2 where id = $1', [owned, coach]);
    await db.query(
      `insert into public.registrations (event_id, registrant_type, staff_profile_id, status, team_id)
       values ($1, 'STAFF', $2, 'VERIFIED', $3)`,
      [event, staff, joined],
    );
    await db.query('delete from public.team_assignments where team_id = any($1::uuid[])', [
      [owned, joined, untouched],
    ]);

    for (let run = 0; run < 2; run++) {
      for (const sql of backfill) await db.query(sql);
    }

    const { rows } = await db.query<{ staff_profile_id: string; team_id: string }>(
      'select staff_profile_id, team_id from public.team_assignments where team_id = any($1::uuid[])',
      [[owned, joined, untouched]],
    );
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { staff_profile_id: coach, team_id: owned },
        { staff_profile_id: staff, team_id: joined },
      ]),
    );
  });

  it('leaves every existing team unlimited', async () => {
    const org = await createOrg(db);
    const event = await createEvent(db, org, { feeCents: 0 });
    const team = await createTeam(db, event);
    const { rows } = await db.query(
      'select max_players, max_coaches, max_staff from public.teams where id = $1',
      [team],
    );
    expect(rows[0]).toEqual({ max_players: null, max_coaches: null, max_staff: null });
  });

  it('refuses a limit of zero or less', async () => {
    const org = await createOrg(db);
    const event = await createEvent(db, org, { feeCents: 0 });
    const team = await createTeam(db, event);
    await expect(
      db.query('update public.teams set max_players = 0 where id = $1', [team]),
    ).rejects.toThrow(/max_players/);
  });
});
