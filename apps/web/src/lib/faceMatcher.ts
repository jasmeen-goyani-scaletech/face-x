import { DEMO_MODE } from './demo/config';
import type { RosterEntry } from './seed';

/**
 * Who is in front of the camera?
 *
 * This app has no face-recognition model: the on-device detector (MediaPipe BlazeFace) only finds *where* a face is, not
 * *whose* it is. So identification is a plug-in point. A real implementation compares the captured frame with the
 * registration photos of `candidates` (e.g. face embeddings) and returns the best match above its confidence threshold,
 * or null. Register it once at startup with `setFaceMatcher(...)`.
 *
 * With no matcher registered the scanner never claims to know anyone: it keeps the camera and face guidance running and
 * sends staff to Manual Search & Approve. The only built-in matcher is a *simulation* for walkthroughs (it returns the
 * next person not yet checked in, without looking at the image), and it is switched on only by NEXT_PUBLIC_DEMO_MODE=true.
 */
export interface FaceMatch {
  id: string;
  /** 0–1. Informational; the matcher itself applies its threshold. */
  confidence: number;
}

export interface FaceMatcher {
  readonly name: string;
  /** True for a simulation, so the UI can say so. */
  readonly isDemo?: boolean;
  match(frameDataUrl: string, candidates: RosterEntry[]): Promise<FaceMatch | null>;
}

const demoMatcher: FaceMatcher = {
  name: 'Demo matcher (not a real face comparison)',
  isDemo: true,
  async match(_frame, candidates) {
    await new Promise((r) => setTimeout(r, 900));
    const next = candidates.find((c) => !c.checkedInAt);
    return next ? { id: next.id, confidence: 0 } : null;
  }
};

let active: FaceMatcher | null = DEMO_MODE ? demoMatcher : null;

export function getFaceMatcher(): FaceMatcher | null {
  return active;
}

export function setFaceMatcher(matcher: FaceMatcher | null) {
  active = matcher;
}

/**
 * Where a person stands for check-in. This follows the same rule as the profile pages (lib/accessCompliance.ts):
 *  - ready:   cleared, nothing outstanding;
 *  - already: checked in earlier (duplicates are blocked);
 *  - blocked: not approved, an open compliance flag, or event-day access switched off. There is no override. A person
 *             who is blocked by compliance has to have it resolved on their profile first.
 */
export type CheckInStatus =
  | { kind: 'ready' }
  | { kind: 'already' }
  | { kind: 'blocked'; reason: string };

export function checkInStatus(e: RosterEntry): CheckInStatus {
  if (e.checkedInAt) return { kind: 'already' };
  if (!e.approved) return { kind: 'blocked', reason: e.pendingReason || 'This registrant is not on the approved list.' };
  if (e.flags.length > 0) {
    return { kind: 'blocked', reason: `Blocked by compliance: ${e.flags.join(', ').toLowerCase()}. Clear these under Photos & Documents on their profile before they can be checked in.` };
  }
  if (e.disabled) return { kind: 'blocked', reason: 'Event-day access has been disabled for this person.' };
  return { kind: 'ready' };
}

/**
 * Only a fully clear person is checked in with no human in the loop. Anyone blocked, with an incomplete payment, a
 * disabled switch, or an earlier check-in goes to an admin instead.
 */
export function isAutoGrantSafe(e: RosterEntry): boolean {
  return checkInStatus(e).kind === 'ready' && (e.role !== 'player' || e.paymentComplete);
}
