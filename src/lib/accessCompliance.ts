import type { RosterEntry } from './seed';
import type { UploadedFile } from './types';

/**
 * The one rule for event-day access. Nothing stores "access is enabled": it is worked out from the person's standing
 * every time, so it cannot go stale or contradict the compliance flags next to it.
 *
 * Access is BLOCKED BY COMPLIANCE, whatever the admin switch says, while any of these is true:
 *   - the registration is not Approved (pending, or rejected);
 *   - a required document / certificate is missing, or any uploaded one is pending review or rejected;
 *   - an open compliance flag remains (e.g. "Parent Consent Pending", "Unverified Document").
 * Only when none applies does the admin switch matter: 'enabled', or 'disabled' if an admin turned it off.
 *
 * There is no override. Clearing a block means resolving it: approve the documents, or clear the flags, under
 * Photos & Documents on the person's profile.
 */
export type RegistrationState = 'approved' | 'pending' | 'rejected';
export type AccessState = 'enabled' | 'blocked' | 'disabled';

export interface AccessCompliance {
  blocked: boolean;
  /** What is unresolved, in plain words, e.g. "2 documents pending review". Empty when not blocked. */
  reasons: string[];
}

export interface ComplianceInput {
  registration: RegistrationState;
  flags: string[];
  /**
   * The person's actual files, when they are on hand (a registration made in this app). Counted individually, so
   * "2 documents pending review" is exact. Without them (sample records) the flags are the only signal.
   */
  documents?: { file: UploadedFile; required: boolean }[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const DOCUMENT_FLAG = /document|certificate/i;

export function accessCompliance({ registration, flags, documents }: ComplianceInput): AccessCompliance {
  const reasons: string[] = [];

  if (registration === 'pending') reasons.push('registration pending approval');
  if (registration === 'rejected') reasons.push('registration rejected');

  if (documents) {
    const missing = documents.filter((d) => d.required && !d.file.uploaded).length;
    const rejected = documents.filter((d) => d.file.uploaded && d.file.review === 'rejected').length;
    const pending = documents.filter((d) => d.file.uploaded && d.file.review !== 'approved' && d.file.review !== 'rejected').length;
    if (missing) reasons.push(`${plural(missing, 'required document')} not uploaded`);
    if (pending) reasons.push(`${plural(pending, 'document')} pending review`);
    if (rejected) reasons.push(`${plural(rejected, 'document')} rejected`);
  }

  // Document flags are already counted above when the files are known; everything else is listed as it reads.
  for (const flag of flags) {
    if (documents && DOCUMENT_FLAG.test(flag)) continue;
    reasons.push(flag.toLowerCase());
  }

  // A flag that the file counts didn't explain still blocks. Never leave a block with no reason.
  if (reasons.length === 0 && flags.length > 0) reasons.push(...flags.map((f) => f.toLowerCase()));

  return { blocked: reasons.length > 0, reasons };
}

/** What the badge shows: compliance wins; otherwise the admin's switch. */
export function accessState(compliance: AccessCompliance, manuallyDisabled: boolean): AccessState {
  if (compliance.blocked) return 'blocked';
  return manuallyDisabled ? 'disabled' : 'enabled';
}

/** "Access blocked: 2 documents pending review, parent consent pending." */
export function blockedSummary(compliance: AccessCompliance): string {
  return `Access blocked: ${compliance.reasons.join(', ')}.`;
}

/**
 * The same rule from a roster row alone (no registration to hand). For a registration made in this app the roster's
 * flags already encode its documents and consent, so this agrees with the profile page. Used by list screens and the
 * scanner, which only have roster rows.
 */
export function entryAccessState(entry: RosterEntry): AccessState {
  const blocked = !entry.approved || entry.flags.length > 0;
  if (blocked) return 'blocked';
  return entry.disabled ? 'disabled' : 'enabled';
}
