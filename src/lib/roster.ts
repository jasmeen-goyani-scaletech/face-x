'use client';

import { useEffect, useMemo } from 'react';
import { cacheRoster } from './offline/rosterCache';
import { enqueueCheckIn, SERVER_CHECKINS_EVENT, type ServerCheckIn } from './offline/syncQueue';
import { useLocalStorage } from './storage';
import { seedRoster, normalizeRosterEntry, upgradeRosterEntry, type RosterEntry } from './seed';
import { calcAge, calcDivision } from './age';
import { getTeamDirectory } from './teams';
import { PLAYER_DOCUMENTS, playerDocument } from './playerDocuments';
import { emptyFile, type PlayerRegistration, type CoachRegistration, type StaffRegistration } from './types';

const ROSTER_KEY = 'facex-event-roster';

function teamNameFor(teamId: string): string {
  return getTeamDirectory().find((t) => t.teamId === teamId)?.teamName || '';
}

/**
 * The open compliance flags for each kind of registration, worked out from the registration itself. Pages that show a
 * person's standing use these directly (not the roster row, which is only refreshed when the roster loads), so what they show
 * always matches the documents in front of the admin. Required documents always count; an optional one only once uploaded.
 */
export function playerFlags(reg: PlayerRegistration): string[] {
  const flags: string[] = [];
  if (reg.consent.required && reg.consent.status !== 'completed') flags.push('Parent Consent Pending');
  const reviewed = [
    reg.documents.profilePhoto,
    ...PLAYER_DOCUMENTS.map((d) => ({ d, f: playerDocument(reg, d.id) }))
      .filter(({ d, f }) => d.required || f.uploaded)
      .map(({ f }) => f)
  ];
  if (reviewed.some((f) => f.review === 'rejected')) flags.push('Document Rejected');
  else if (reviewed.some((f) => f.review !== 'approved')) flags.push('Unverified Document');
  return flags;
}

export function coachFlags(reg: CoachRegistration): string[] {
  // The live photo only counts once uploaded: coach registrations saved before the photo step have none.
  const certs = [...(reg.livePhoto?.uploaded ? [reg.livePhoto] : []), reg.certificates.firstAidCpr, reg.certificates.yalfTackle, reg.certificates.backgroundCheckRef];
  if (certs.some((c) => c.review === 'rejected')) return ['Certificate Rejected'];
  if (certs.some((c) => c.review !== 'approved')) return ['Unverified Document'];
  return [];
}

export function staffFlags(reg: StaffRegistration): string[] {
  // The photo and background check are required. Safe-Sport is optional, so it only counts once uploaded:
  // an unused optional slot must not leave a permanent "Unverified Document" flag.
  const docs = [reg.livePhoto, reg.backgroundCheckRef, ...(reg.safeSportUpload.uploaded ? [reg.safeSportUpload] : [])];
  if (docs.some((d) => d.review === 'rejected')) return ['Document Rejected'];
  if (docs.some((d) => d.review !== 'approved')) return ['Unverified Document'];
  return [];
}

function selfEntryFromPlayer(reg: PlayerRegistration): RosterEntry | null {
  if (reg.status !== 'submitted') return null;
  const flags = playerFlags(reg);
  return {
    id: 'self-player',
    firstName: reg.basic.firstName,
    lastName: reg.basic.lastName,
    dob: reg.basic.dob,
    schoolId: reg.id || 'PLAYER',
    role: 'player',
    teamName: teamNameFor(reg.teamId),
    teamId: reg.teamId,
    jerseyNumber: '',
    position: '',
    guardianName: (calcAge(reg.basic.dob) ?? 0) < 18 ? reg.emergency.guardianName : '',
    division: calcDivision(reg.basic.dob) || '',
    phone: reg.basic.phone,
    email: reg.basic.email,
    parentPhone: (calcAge(reg.basic.dob) ?? 0) < 18 ? reg.emergency.guardianPhone : '',
    photoUrl: reg.documents.profilePhoto.dataUrl || '',
    approved: reg.payment.status === 'success',
    paymentComplete: reg.payment.status === 'success',
    flags,
    pendingReason: reg.payment.status === 'success' ? '' : 'Registration payment is incomplete',
    disabled: false,
    checkedInAt: null,
    checkedInMethod: null,
    checkedInOverride: false
  };
}

function selfEntryFromCoach(reg: CoachRegistration): RosterEntry | null {
  if (reg.status !== 'submitted') return null;
  const flags = coachFlags(reg);
  return {
    id: 'self-coach',
    firstName: reg.basic.firstName,
    lastName: reg.basic.lastName,
    dob: '1990-01-01',
    schoolId: reg.id || 'COACH',
    role: 'coach',
    teamName: reg.invite?.teamName || reg.team?.teamName || '',
    parentPhone: '',
    teamId: reg.invite?.teamId || reg.team?.teamId || '',
    jerseyNumber: '',
    position: '',
    guardianName: '',
    division: '',
    phone: reg.basic.phone,
    photoUrl: reg.livePhoto?.dataUrl || '',
    approved: reg.adminStatus === 'approved',
    paymentComplete: true,
    flags,
    pendingReason: reg.adminStatus === 'approved' ? '' : 'Certificates still pending admin verification',
    disabled: false,
    checkedInAt: null,
    checkedInMethod: null,
    checkedInOverride: false
  };
}

function selfEntryFromStaff(reg: StaffRegistration): RosterEntry | null {
  if (reg.status !== 'submitted') return null;
  const flags = staffFlags(reg);
  return {
    id: 'self-staff',
    firstName: reg.basic.firstName,
    lastName: reg.basic.lastName,
    dob: '1990-01-01',
    schoolId: reg.id || 'STAFF',
    role: 'staff',
    teamName: reg.invite?.teamName || '',
    parentPhone: '',
    teamId: reg.invite?.teamId || '',
    jerseyNumber: '',
    position: '',
    guardianName: '',
    division: '',
    phone: reg.basic.phone,
    photoUrl: reg.livePhoto.dataUrl || '',
    approved: reg.adminStatus === 'approved',
    paymentComplete: true,
    flags,
    pendingReason: reg.adminStatus === 'approved' ? '' : 'Registration still pending admin verification',
    disabled: false,
    checkedInAt: null,
    checkedInMethod: null,
    checkedInOverride: false
  };
}

/** Combines the seeded demo roster with any of this browser's own registrations, so the admin
 * scanner reflects the same journey a visitor just walked through in /register. Self-entries always
 * appear once submitted (even mid-review) so the field-admin override flow has something real to show. */
export function useEventRoster() {
  const [rawRoster, setRoster, hydrated] = useLocalStorage<RosterEntry[]>(ROSTER_KEY, seedRoster());

  // Normalized at render time (not just in an effect) so even the very first render is safe
  // against a roster saved by an older schema version — see normalizeRosterEntry.
  const roster = useMemo(() => rawRoster.map(normalizeRosterEntry), [rawRoster]);

  useEffect(() => {
    // Until the saved roster has been read, `rawRoster` is a throwaway seed with fresh random ids. Upgrading and saving that
    // would overwrite the real roster on every mount and change every id, so admin detail pages couldn't find their person.
    if (!hydrated) return;
    const directory = getTeamDirectory();
    const sample = new Map(seedRoster().map((s) => [s.schoolId, s]));
    const patched = rawRoster.map((r) => upgradeRosterEntry(r, sample.get(r.schoolId ?? ''), directory));
    // Only write back when something actually changed, so this settles after one pass.
    if (patched.some((p, i) => JSON.stringify(p) !== JSON.stringify(rawRoster[i]))) setRoster(patched);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawRoster, hydrated]);

  useEffect(() => {
    try {
      const additions: RosterEntry[] = [];
      const playerRaw = window.localStorage.getItem('facex-player-registration');
      const coachRaw = window.localStorage.getItem('facex-coach-registration');
      const staffRaw = window.localStorage.getItem('facex-staff-registration');
      if (playerRaw) {
        const e = selfEntryFromPlayer(JSON.parse(playerRaw));
        if (e) additions.push(e);
      }
      if (coachRaw) {
        const e = selfEntryFromCoach(JSON.parse(coachRaw));
        if (e) additions.push(e);
      }
      if (staffRaw) {
        const e = selfEntryFromStaff(JSON.parse(staffRaw));
        if (e) additions.push(e);
      }
      if (additions.length === 0) return;
      setRoster((prev) => {
        const byId = new Map(additions.map((a) => [a.id, a]));
        const refreshed = prev.map((p) => {
          const fresh = byId.get(p.id);
          if (!fresh) return p;
          byId.delete(p.id);
          return {
            ...fresh,
            disabled: p.disabled,
            checkedInAt: p.checkedInAt,
            checkedInMethod: p.checkedInMethod,
            checkedInOverride: p.checkedInOverride
          };
        });
        return byId.size ? [...refreshed, ...byId.values()] : refreshed;
      });
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Check-ins (and admin actions on the roster) happen from other tabs/routes in this same
  // browser (e.g. the scanner open in one tab, an admin detail page in another) — localStorage's
  // native 'storage' event fires cross-tab, so listening for it keeps this view "live" without
  // polling or a real backend.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== ROSTER_KEY || !e.newValue) return;
      try {
        setRoster(JSON.parse(e.newValue));
      } catch {
        // ignore malformed cross-tab payloads
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep a complete, indexed copy of the roster in IndexedDB so search and check-in keep working with no network.
  useEffect(() => {
    void cacheRoster(roster);
  }, [roster]);

  // After a sync, the server's check-ins are the clean source: fill in anyone it recorded that this device doesn't show yet.
  useEffect(() => {
    function onServerCheckIns(e: Event) {
      const checkIns = (e as CustomEvent<ServerCheckIn[]>).detail;
      setRoster((prev) => {
        // Matched on registration ID + role: a roster row's own id is random per browser, so it can't identify anyone across devices.
        const byPerson = new Map(checkIns.map((c) => [`${c.role}:${c.schoolId}`, c]));
        let changed = false;
        const next = prev.map((r) => {
          const c = r.schoolId ? byPerson.get(`${r.role}:${r.schoolId}`) : undefined;
          if (!c || r.checkedInAt) return r;
          changed = true;
          return { ...r, checkedInAt: c.checkedInAt, checkedInMethod: c.method, checkedInOverride: c.override };
        });
        return changed ? next : prev;
      });
    }
    window.addEventListener(SERVER_CHECKINS_EVENT, onServerCheckIns);
    return () => window.removeEventListener(SERVER_CHECKINS_EVENT, onServerCheckIns);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function markPresent(id: string, method: string, override: boolean) {
    const at = Date.now();
    const person = roster.find((r) => r.id === id);
    // Optimistic: the roster (and so the UI) updates immediately; the queue entry is what carries it to Admin later.
    setRoster((prev) =>
      prev.map((r) => (r.id === id ? { ...normalizeRosterEntry(r), checkedInAt: at, checkedInMethod: method, checkedInOverride: override } : r))
    );
    if (person) void enqueueCheckIn(person, method, override, at);
  }

  function setDisabled(id: string, disabled: boolean) {
    setRoster((prev) => prev.map((r) => (r.id === id ? { ...normalizeRosterEntry(r), disabled } : r)));
  }

  /** For seed/demo roster entries with no backing registration object — the only entries whose
   * compliance state lives directly on the roster row rather than in a real registration. */
  function clearFlagsAndApprove(id: string) {
    setRoster((prev) => prev.map((r) => (r.id === id ? { ...normalizeRosterEntry(r), approved: true, flags: [], pendingReason: '' } : r)));
  }

  function approvedUnchecked() {
    return roster.filter((r) => r.approved && !r.checkedInAt);
  }

  return { roster, markPresent, setDisabled, clearFlagsAndApprove, approvedUnchecked, ageOf: (dob: string) => calcAge(dob) };
}
