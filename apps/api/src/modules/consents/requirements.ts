/**
 * The consent rules, with no database and no other module, so the consent API and registration readiness apply
 * exactly the same rule.
 *
 *  - GUARDIAN_CONSENT is required when the player is a minor on the event-local start date, never for an adult.
 *  - AB506_ACKNOWLEDGEMENT is required of every coach (it is only ever listed for coach registrations).
 *  - No other consent is required (the biometric consent belongs to face enrollment).
 *  - "Accepted" means the CURRENT published version was accepted for this registration. If no version has been
 *    published yet there is nothing to accept, so a required consent cannot be satisfied.
 */
export function isConsentRequired(code: string, isMinor: boolean): boolean {
  if (code === 'AB506_ACKNOWLEDGEMENT') return true;
  return code === 'GUARDIAN_CONSENT' ? isMinor : false;
}

export function consentRequirement<V extends { id: string }>(
  code: string,
  isMinor: boolean,
  current: V | null,
  records: readonly { consentId: string }[],
): { code: string; required: boolean; current: V | null; accepted: boolean } {
  return {
    code,
    required: isConsentRequired(code, isMinor),
    current,
    accepted: current !== null && records.some((r) => r.consentId === current.id),
  };
}

/** Every required consent has been accepted at its current version. */
export function consentsSatisfied(
  requirements: readonly { required: boolean; accepted: boolean }[],
): boolean {
  return requirements.every((r) => !r.required || r.accepted);
}
