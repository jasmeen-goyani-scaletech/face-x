import type { AccessCompliance, RegistrationState } from './accessCompliance';

/**
 * A record is LOCKED (documents read-only) once it is fully cleared: the registration is approved and nothing is
 * outstanding (no missing / pending / rejected documents, no open flags). Like event-day access, this is worked out from the
 * record's standing every time, never stored, so it cannot disagree with the access badge:
 *   - everything approved   → locked, and access is Enabled (unless an admin switched it off. That doesn't unlock anything);
 *   - any document goes back to pending / rejected, or a flag opens → access is Blocked and the lock lifts in the same render.
 *
 * While locked, the only document action is Preview. To correct a mistake, reject the registration (Coach and Staff have a
 * Registration Decision card for this); that blocks access, which unlocks the documents.
 */
export function isRecordLocked(registration: RegistrationState, compliance: AccessCompliance): boolean {
  return registration === 'approved' && !compliance.blocked;
}
