import { compact, validators, type FieldErrors } from './validation';
import type { PlayerRegistration } from './types';

export const MIN_GUESTS = 0;
export const MAX_GUESTS = 10;

/** Keys equal the input ids in GuardianConsentStep, so submit can focus the first invalid field. */
export type GuardianField = 'guardianName' | 'relationship' | 'guardianPhone' | 'guardianEmail' | 'agree' | 'signedName' | 'guestCount';
export type GuardianErrors = FieldErrors<GuardianField>;

/** Case-, spacing- and edge-whitespace-insensitive, so "jane  DOE " matches "Jane Doe". */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function clampGuestCount(value: unknown): number {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? Math.min(MAX_GUESTS, Math.max(MIN_GUESTS, n)) : 0;
}

/** Rules for a minor's Guardian & Consent step. Returns an empty object when everything is valid. */
export function validateGuardianConsent(reg: PlayerRegistration): GuardianErrors {
  const g = reg.emergency;
  const guests = g.guestCount ?? 0;

  return compact<GuardianField>({
    guardianName: g.guardianName.trim().length >= 2 ? null : 'Please enter the parent/guardian’s full name (at least 2 characters).',
    relationship: g.relationship.trim() ? null : 'Please enter your relationship to the player (e.g., Parent, Legal Guardian).',
    guardianPhone: validators.phone(g.guardianPhone),
    guardianEmail: validators.email(g.guardianEmail),
    agree: reg.consent.agree ? null : 'Please check the box to accept the consent and liability waiver.',
    signedName: !reg.consent.signedName.trim()
      ? 'Please type your full name to sign.'
      : normalizeName(reg.consent.signedName) !== normalizeName(g.guardianName)
        ? 'Your signature must match the parent/guardian full name entered above.'
        : null,
    guestCount:
      Number.isInteger(guests) && guests >= MIN_GUESTS && guests <= MAX_GUESTS
        ? null
        : `Please enter a whole number from ${MIN_GUESTS} to ${MAX_GUESTS}.`
  });
}
