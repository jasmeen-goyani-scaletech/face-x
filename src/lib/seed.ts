export const EVENT_INFO = {
  name: 'Fall Tackle Kickoff Night',
  date: '2026-11-14',
  time: '5:30 PM – 8:00 PM',
  location: 'Roosevelt Community Field, 4820 Sequoia Ave, Sacramento, CA'
};

export interface RosterEntry {
  id: string;
  firstName: string;
  lastName: string;
  dob: string;
  schoolId: string;
  role: 'player' | 'coach' | 'staff';
  teamName: string;
  division: string;
  photoUrl: string;
  approved: boolean; // false = not on the eligible list at all; check-in is fully blocked, no override
  paymentComplete: boolean;
  flags: string[]; // soft-blocker warnings on an otherwise-approved registrant; admin can override
  pendingReason: string;
  checkedInAt: number | null;
  checkedInMethod: string | null;
  checkedInOverride: boolean;
}

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Fills in defaults for any field missing from a stored entry, so a roster saved by an older
 * version of this schema (a returning visitor's stale localStorage) never crashes a render —
 * it just displays as if those fields were never set, and self-heals next time it's re-saved. */
export function normalizeRosterEntry(r: Partial<RosterEntry>): RosterEntry {
  return {
    id: r.id ?? uid('reg'),
    firstName: r.firstName ?? '',
    lastName: r.lastName ?? '',
    dob: r.dob ?? '',
    schoolId: r.schoolId ?? '',
    role: r.role ?? 'player',
    teamName: r.teamName ?? '',
    division: r.division ?? '',
    photoUrl: r.photoUrl ?? '',
    approved: r.approved ?? false,
    paymentComplete: r.paymentComplete ?? false,
    flags: r.flags ?? [],
    pendingReason: r.pendingReason ?? '',
    checkedInAt: r.checkedInAt ?? null,
    checkedInMethod: r.checkedInMethod ?? null,
    checkedInOverride: r.checkedInOverride ?? false
  };
}

interface SeedRow {
  firstName: string;
  lastName: string;
  dob: string;
  schoolId: string;
  role: 'player' | 'coach' | 'staff';
  teamName: string;
  division: string;
  approved: boolean;
  paymentComplete: boolean;
  flags: string[];
  checkedInSeed: boolean;
}

export function seedRoster(): RosterEntry[] {
  const raw: SeedRow[] = [
    { firstName: 'Amara', lastName: 'Whitfield', dob: '2014-03-11', schoolId: 'SID-48213', role: 'player', teamName: 'Sacramento River Cats U14', division: 'U14', approved: true, paymentComplete: true, flags: [], checkedInSeed: false },
    { firstName: 'Deshawn', lastName: 'Cole', dob: '2013-09-02', schoolId: 'SID-48214', role: 'player', teamName: 'Sacramento River Cats U14', division: 'U14', approved: true, paymentComplete: true, flags: [], checkedInSeed: false },
    { firstName: 'Priya', lastName: 'Shah', dob: '2014-01-22', schoolId: 'SID-48215', role: 'player', teamName: 'Sacramento River Cats U14', division: 'U14', approved: true, paymentComplete: true, flags: [], checkedInSeed: false },
    { firstName: 'Marcus', lastName: 'Lee', dob: '2013-07-19', schoolId: 'SID-48216', role: 'player', teamName: 'LA Galaxy Youth U16', division: 'U16', approved: true, paymentComplete: true, flags: [], checkedInSeed: true },
    { firstName: 'Sofia', lastName: 'Reyes', dob: '2014-05-30', schoolId: 'SID-48217', role: 'player', teamName: 'San Diego Wave U12', division: 'U12', approved: true, paymentComplete: true, flags: [], checkedInSeed: false },
    { firstName: 'Jordan', lastName: 'Price', dob: '2013-11-08', schoolId: 'SID-48218', role: 'player', teamName: 'LA Galaxy Youth U16', division: 'U16', approved: true, paymentComplete: true, flags: ['Parent Consent Pending'], checkedInSeed: false },
    { firstName: 'Malik', lastName: 'Johnson', dob: '2013-12-25', schoolId: 'SID-48220', role: 'player', teamName: 'Sacramento River Cats U14', division: 'U14', approved: true, paymentComplete: false, flags: ['Payment Incomplete'], checkedInSeed: false },
    { firstName: 'Evelyn', lastName: 'Nakamura', dob: '2014-02-14', schoolId: 'SID-48219', role: 'player', teamName: 'San Diego Wave U12', division: 'U12', approved: false, paymentComplete: false, flags: [], checkedInSeed: false },
    { firstName: 'Coach Daniels', lastName: 'R.', dob: '1988-04-02', schoolId: 'STAFF-001', role: 'coach', teamName: 'Sacramento River Cats U14', division: '', approved: true, paymentComplete: true, flags: [], checkedInSeed: false },
    { firstName: 'Rosa', lastName: 'Fields', dob: '1990-06-15', schoolId: 'STAFF-002', role: 'staff', teamName: 'Sacramento Youth Football League', division: '', approved: true, paymentComplete: true, flags: ['Unverified Document'], checkedInSeed: false }
  ];
  return raw.map((r) => {
    let checkedInAt: number | null = null;
    let checkedInMethod: string | null = null;
    if (r.checkedInSeed) {
      const d = new Date();
      d.setHours(10, 14, 0, 0);
      checkedInAt = d.getTime();
      checkedInMethod = 'Face Scan';
    }
    return {
      id: uid('reg'),
      firstName: r.firstName,
      lastName: r.lastName,
      dob: r.dob,
      schoolId: r.schoolId,
      role: r.role,
      teamName: r.teamName,
      division: r.division,
      photoUrl: '',
      approved: r.approved,
      paymentComplete: r.paymentComplete,
      flags: r.flags,
      pendingReason: r.approved ? '' : 'Registration documents still under review',
      checkedInAt,
      checkedInMethod,
      checkedInOverride: false
    };
  });
}
