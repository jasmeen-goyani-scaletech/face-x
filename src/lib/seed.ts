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
  /** The person's own mobile. Empty when none is on file (a young player may not have one). */
  phone: string;
  /** A minor's parent / guardian mobile. Empty for adults and when none is on file. */
  parentPhone: string;
  /** The team's id (not just its name), so a coach's roster can be matched to exactly one team. */
  teamId: string;
  /** Not collected at registration yet; empty for real registrants. */
  jerseyNumber: string;
  position: string;
  /** The parent / guardian to contact for a minor. */
  guardianName: string;
  photoUrl: string;
  approved: boolean; // false = not on the eligible list at all; check-in is fully blocked, no override
  paymentComplete: boolean;
  flags: string[]; // soft-blocker warnings on an otherwise-approved registrant; admin can override
  pendingReason: string;
  disabled: boolean; // admin-toggled event-day access block, independent of document/payment approval
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
    phone: r.phone ?? '',
    parentPhone: r.parentPhone ?? '',
    teamId: r.teamId ?? '',
    jerseyNumber: r.jerseyNumber ?? '',
    position: r.position ?? '',
    guardianName: r.guardianName ?? '',
    photoUrl: r.photoUrl ?? '',
    approved: r.approved ?? false,
    paymentComplete: r.paymentComplete ?? false,
    flags: r.flags ?? [],
    pendingReason: r.pendingReason ?? '',
    disabled: r.disabled ?? false,
    checkedInAt: r.checkedInAt ?? null,
    checkedInMethod: r.checkedInMethod ?? null,
    checkedInOverride: r.checkedInOverride ?? false
  };
}

/**
 * Brings a roster entry saved by an older version up to date, without losing or mislabelling anything.
 *  - New fields (jersey, position, guardian, team id) are filled from the sample data and the team directory when missing.
 *  - Phone numbers: before `parentPhone` existed, a player's `phone` held their PARENT's number. For such an entry that
 *    number becomes `parentPhone` and the player's own number is whatever the sample has (usually none). It is never
 *    relabelled as the player's own.
 */
export function upgradeRosterEntry(
  stored: Partial<RosterEntry>,
  sample: Partial<RosterEntry> | undefined,
  directory: { teamId: string; teamName: string }[]
): RosterEntry {
  const oldPlayer = stored.parentPhone === undefined && stored.role === 'player';
  return normalizeRosterEntry({
    ...stored,
    phone: oldPlayer ? sample?.phone ?? '' : stored.phone ?? sample?.phone,
    parentPhone: stored.parentPhone ?? (oldPlayer ? sample?.parentPhone ?? stored.phone : sample?.parentPhone),
    jerseyNumber: stored.jerseyNumber ?? sample?.jerseyNumber,
    position: stored.position ?? sample?.position,
    guardianName: stored.guardianName ?? sample?.guardianName,
    teamId: stored.teamId || directory.find((t) => t.teamName === stored.teamName)?.teamId || ''
  });
}

interface SeedRow {
  firstName: string;
  lastName: string;
  dob: string;
  schoolId: string;
  phone: string;
  parentPhone?: string;
  jerseyNumber?: string;
  position?: string;
  guardianName?: string;
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
    { firstName: 'Amara', lastName: 'Whitfield', dob: '2014-03-11', schoolId: 'SID-48213', phone: '', parentPhone: '(555) 010-0113', jerseyNumber: '7', position: 'Forward', guardianName: 'Dana Whitfield', role: 'player', teamName: 'Sacramento River Cats U14', division: 'U14', approved: true, paymentComplete: true, flags: [], checkedInSeed: false },
    { firstName: 'Deshawn', lastName: 'Cole', dob: '2013-09-02', schoolId: 'SID-48214', phone: '(555) 010-0314', parentPhone: '(555) 010-0114', jerseyNumber: '12', position: 'Defender', guardianName: 'Marcus Cole', role: 'player', teamName: 'Sacramento River Cats U14', division: 'U14', approved: true, paymentComplete: true, flags: [], checkedInSeed: false },
    { firstName: 'Priya', lastName: 'Shah', dob: '2014-01-22', schoolId: 'SID-48215', phone: '', parentPhone: '(555) 010-0115', jerseyNumber: '4', position: 'Midfielder', guardianName: 'Anita Shah', role: 'player', teamName: 'Sacramento River Cats U14', division: 'U14', approved: true, paymentComplete: true, flags: [], checkedInSeed: false },
    { firstName: 'Marcus', lastName: 'Lee', dob: '2013-07-19', schoolId: 'SID-48216', phone: '(555) 010-0316', parentPhone: '(555) 010-0116', jerseyNumber: '10', position: 'Forward', guardianName: 'Grace Lee', role: 'player', teamName: 'LA Galaxy Youth U16', division: 'U16', approved: true, paymentComplete: true, flags: [], checkedInSeed: true },
    { firstName: 'Sofia', lastName: 'Reyes', dob: '2014-05-30', schoolId: 'SID-48217', phone: '', parentPhone: '(555) 010-0117', jerseyNumber: '1', position: 'Goalkeeper', guardianName: 'Elena Reyes', role: 'player', teamName: 'San Diego Wave U12', division: 'U12', approved: true, paymentComplete: true, flags: [], checkedInSeed: false },
    { firstName: 'Jordan', lastName: 'Price', dob: '2013-11-08', schoolId: 'SID-48218', phone: '(555) 010-0318', parentPhone: '(555) 010-0118', jerseyNumber: '23', position: 'Defender', guardianName: 'Tamara Price', role: 'player', teamName: 'LA Galaxy Youth U16', division: 'U16', approved: true, paymentComplete: true, flags: ['Parent Consent Pending'], checkedInSeed: false },
    { firstName: 'Malik', lastName: 'Johnson', dob: '2013-12-25', schoolId: 'SID-48220', phone: '', parentPhone: '(555) 010-0120', jerseyNumber: '9', position: 'Forward', guardianName: 'Denise Johnson', role: 'player', teamName: 'Sacramento River Cats U14', division: 'U14', approved: true, paymentComplete: false, flags: ['Payment Incomplete'], checkedInSeed: false },
    { firstName: 'Evelyn', lastName: 'Nakamura', dob: '2014-02-14', schoolId: 'SID-48219', phone: '', parentPhone: '(555) 010-0119', jerseyNumber: '15', position: 'Midfielder', guardianName: 'Keiko Nakamura', role: 'player', teamName: 'San Diego Wave U12', division: 'U12', approved: false, paymentComplete: false, flags: [], checkedInSeed: false },
    { firstName: 'Coach Daniels', lastName: 'R.', dob: '1988-04-02', schoolId: 'STAFF-001', phone: '(555) 010-0201', role: 'coach', teamName: 'Sacramento River Cats U14', division: '', approved: true, paymentComplete: true, flags: [], checkedInSeed: false },
    { firstName: 'Rosa', lastName: 'Fields', dob: '1990-06-15', schoolId: 'STAFF-002', phone: '(555) 010-0202', role: 'staff', teamName: 'Sacramento Youth Football League', division: '', approved: true, paymentComplete: true, flags: ['Unverified Document'], checkedInSeed: false }
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
      phone: r.phone,
      parentPhone: r.parentPhone ?? '',
      teamId: '',
      jerseyNumber: r.jerseyNumber ?? '',
      position: r.position ?? '',
      guardianName: r.guardianName ?? '',
      photoUrl: '',
      approved: r.approved,
      paymentComplete: r.paymentComplete,
      flags: r.flags,
      pendingReason: r.approved ? '' : 'Registration documents still under review',
      disabled: false,
      checkedInAt,
      checkedInMethod,
      checkedInOverride: false
    };
  });
}
