import type { ApiFaceScan } from './api/types';
import type { RosterEntry } from './seed';

/** What the scanner screen does with the server's answer to one photo. */
export type ScanOutcome =
  /** Clearly this person, and nothing stands in the way: check them in now, by face. */
  | { kind: 'checkin'; entry: RosterEntry; scanId: string }
  /** A person staff must look at (a doubtful match, or a clear one that is blocked or already in): shown beside the camera. */
  | { kind: 'review'; entry: RosterEntry }
  /** Several people look alike: staff pick the right one by hand. */
  | { kind: 'several'; names: string[] }
  | { kind: 'nomatch' }
  /** Matched someone this device's roster does not have (it is out of date). */
  | { kind: 'unknown' };

const byId = (roster: readonly RosterEntry[], id: string) => roster.find((r) => r.id === id);

/**
 * Decides what a scan means for the screen. Only a MATCH of someone who is clear to enter and not yet in is checked in without a person
 * deciding; everything doubtful goes to staff. (The server re-checks all of it when the check-in is made.)
 */
export function resolveScan(
  scan: ApiFaceScan,
  roster: readonly RosterEntry[],
  /** Whether this person may be checked in with no human deciding (lib/faceMatcher isAutoGrantSafe). */
  canAutoGrant: (entry: RosterEntry) => boolean
): ScanOutcome {
  if (scan.result === 'NO_MATCH') return { kind: 'nomatch' };

  if (scan.result === 'REVIEW_REQUIRED') {
    const people = scan.candidates.map((c) => byId(roster, c.registrationId)).filter((e): e is RosterEntry => e !== undefined);
    if (people.length === 1) return { kind: 'review', entry: people[0]! };
    if (people.length > 1) return { kind: 'several', names: people.map((p) => `${p.firstName} ${p.lastName}`) };
    // Candidates the server named but this device does not have: use the names the server gave.
    if (scan.candidates.length > 1) return { kind: 'several', names: scan.candidates.map((c) => c.displayName) };
    return scan.candidates.length === 1 ? { kind: 'unknown' } : { kind: 'nomatch' };
  }

  const entry = byId(roster, scan.registration.registrationId);
  if (!entry) return { kind: 'unknown' };
  if (scan.alreadyCheckedIn || entry.checkedInAt) return { kind: 'review', entry };
  return canAutoGrant(entry) ? { kind: 'checkin', entry, scanId: scan.scanId } : { kind: 'review', entry };
}

/** Why a scan could not be made, in words for the door, and what the screen should do about it. */
export interface ScanProblem {
  /** `unavailable`: face matching is not set up on the server. `retry`: take the photo again. `offline`: the server could not be reached. */
  kind: 'unavailable' | 'retry' | 'offline' | 'busy' | 'other';
  text: string;
}

export function describeScanProblem(err: unknown): ScanProblem {
  // An ApiError (lib/api/errors), recognised by its shape so this file needs no imports at run time.
  const e = err as { name?: string; code?: string; status?: number } | null;
  if (!e || e.name !== 'ApiError' || typeof e.status !== 'number') return { kind: 'other', text: 'The scan could not be completed. Scan again, or use Manual Search & Approve.' };
  switch (e.code) {
    case 'FACE_NOT_CONFIGURED':
      return { kind: 'unavailable', text: 'Face matching isn’t set up on the server yet. Use Manual Search & Approve.' };
    case 'FACE_NOT_DETECTED':
      return { kind: 'retry', text: 'No face was found in the photo. Face the camera, in good light, and scan again.' };
    case 'FACE_MULTIPLE':
      return { kind: 'retry', text: 'More than one face was in the photo. Scan one person at a time.' };
    case 'FACE_LOW_QUALITY':
      return { kind: 'retry', text: 'The face was too small or unclear. Move closer and scan again.' };
    case 'FACE_IMAGE_REJECTED':
    case 'IMAGE_INVALID':
    case 'IMAGE_REQUIRED':
      return { kind: 'retry', text: 'The photo could not be read. Scan again.' };
    case 'RATE_LIMITED':
      return { kind: 'busy', text: 'Too many scans in a short time. Wait a moment, then scan again.' };
    case 'FACE_PROVIDER_TIMEOUT':
    case 'FACE_PROVIDER_UNAVAILABLE':
      return { kind: 'offline', text: 'Face matching is busy or unavailable right now. Scan again, or use Manual Search & Approve.' };
    default:
      break;
  }
  if (e.status === 0 || e.status === 408 || e.status >= 500) {
    return { kind: 'offline', text: 'The server can’t be reached, so faces can’t be compared. Use Manual Search & Approve: check-ins are saved and sent when the connection returns.' };
  }
  return { kind: 'other', text: 'The scan could not be completed. Scan again, or use Manual Search & Approve.' };
}
