'use client';

import { useEffect, useMemo } from 'react';
import { useLocalStorage } from './storage';
import { seedRoster, normalizeRosterEntry, type RosterEntry } from './seed';
import { calcAge, calcDivision } from './age';
import { TEAM_DIRECTORY } from './teams';
import type { PlayerRegistration, CoachRegistration, StaffRegistration } from './types';

const ROSTER_KEY = 'facex-event-roster';

function teamNameFor(teamId: string): string {
  return TEAM_DIRECTORY.find((t) => t.teamId === teamId)?.teamName || '';
}

function selfEntryFromPlayer(reg: PlayerRegistration): RosterEntry | null {
  if (reg.status !== 'submitted') return null;
  const flags: string[] = [];
  if (reg.consent.required && reg.consent.status !== 'completed') flags.push('Parent Consent Pending');
  if (reg.documents.profilePhoto.review === 'rejected' || reg.documents.birthCertificateOrPassport.review === 'rejected') {
    flags.push('Document Rejected');
  } else if (reg.documents.profilePhoto.review !== 'approved' || reg.documents.birthCertificateOrPassport.review !== 'approved') {
    flags.push('Unverified Document');
  }
  return {
    id: 'self-player',
    firstName: reg.basic.firstName,
    lastName: reg.basic.lastName,
    dob: reg.basic.dob,
    schoolId: reg.id || 'PLAYER',
    role: 'player',
    teamName: teamNameFor(reg.teamId),
    division: calcDivision(reg.basic.dob) || '',
    photoUrl: reg.documents.profilePhoto.dataUrl || '',
    approved: reg.payment.status === 'success',
    paymentComplete: reg.payment.status === 'success',
    flags,
    pendingReason: reg.payment.status === 'success' ? '' : 'Registration payment is incomplete',
    checkedInAt: null,
    checkedInMethod: null,
    checkedInOverride: false
  };
}

function selfEntryFromCoach(reg: CoachRegistration): RosterEntry | null {
  if (reg.status !== 'submitted') return null;
  const flags: string[] = [];
  const certs = [reg.certificates.firstAidCpr, reg.certificates.yalfTackle, reg.certificates.backgroundCheckRef];
  if (certs.some((c) => c.review === 'rejected')) flags.push('Certificate Rejected');
  else if (certs.some((c) => c.review !== 'approved')) flags.push('Unverified Document');
  return {
    id: 'self-coach',
    firstName: reg.basic.firstName,
    lastName: reg.basic.lastName,
    dob: '1990-01-01',
    schoolId: reg.id || 'COACH',
    role: 'coach',
    teamName: reg.team?.teamName || '',
    division: '',
    photoUrl: '',
    approved: reg.adminStatus === 'approved',
    paymentComplete: true,
    flags,
    pendingReason: reg.adminStatus === 'approved' ? '' : 'Certificates still pending admin verification',
    checkedInAt: null,
    checkedInMethod: null,
    checkedInOverride: false
  };
}

function selfEntryFromStaff(reg: StaffRegistration): RosterEntry | null {
  if (reg.status !== 'submitted') return null;
  const flags: string[] = [];
  const docs = [reg.backgroundCheckRef, reg.safeSportUpload];
  if (docs.some((d) => d.review === 'rejected')) flags.push('Document Rejected');
  else if (docs.some((d) => d.review !== 'approved')) flags.push('Unverified Document');
  return {
    id: 'self-staff',
    firstName: reg.basic.firstName,
    lastName: reg.basic.lastName,
    dob: '1990-01-01',
    schoolId: reg.id || 'STAFF',
    role: 'staff',
    teamName: reg.clubAffiliation,
    division: '',
    photoUrl: reg.livePhoto.dataUrl || '',
    approved: reg.adminStatus === 'approved',
    paymentComplete: true,
    flags,
    pendingReason: reg.adminStatus === 'approved' ? '' : 'Registration still pending admin verification',
    checkedInAt: null,
    checkedInMethod: null,
    checkedInOverride: false
  };
}

/** Combines the seeded demo roster with any of this browser's own registrations, so the admin
 * scanner reflects the same journey a visitor just walked through in /register. Self-entries always
 * appear once submitted (even mid-review) so the field-admin override flow has something real to show. */
export function useEventRoster() {
  const [rawRoster, setRoster] = useLocalStorage<RosterEntry[]>(ROSTER_KEY, seedRoster());

  // Normalized at render time (not just in an effect) so even the very first render is safe
  // against a roster saved by an older schema version — see normalizeRosterEntry.
  const roster = useMemo(() => rawRoster.map(normalizeRosterEntry), [rawRoster]);

  useEffect(() => {
    if (rawRoster.some((r) => r.flags === undefined)) {
      setRoster((prev) => prev.map(normalizeRosterEntry));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawRoster]);

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
          return { ...fresh, checkedInAt: p.checkedInAt, checkedInMethod: p.checkedInMethod, checkedInOverride: p.checkedInOverride };
        });
        return byId.size ? [...refreshed, ...byId.values()] : refreshed;
      });
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function markPresent(id: string, method: string, override: boolean) {
    setRoster((prev) =>
      prev.map((r) => (r.id === id ? { ...normalizeRosterEntry(r), checkedInAt: Date.now(), checkedInMethod: method, checkedInOverride: override } : r))
    );
  }

  function approvedUnchecked() {
    return roster.filter((r) => r.approved && !r.checkedInAt);
  }

  return { roster, markPresent, approvedUnchecked, ageOf: (dob: string) => calcAge(dob) };
}
