/**
 * What the API tells a client about face enrollment. Deliberately minimal: no provider name, no provider
 * reference, no image or score. The only biometric fact exposed is whether an enrollment exists and when.
 */
export interface FaceProfileStatusDto {
  playerId: string;
  status: 'NOT_ENROLLED' | 'ACTIVE' | 'REVOKED';
  enrolledAt: string | null;
  revokedAt: string | null;
}

/**
 * The consent that must be on record before a player can be enrolled. The WORDING lives in the database
 * (`consents`), published by the client; this only names which consent code to require.
 *   undefined  not decided yet: enrollment is disabled (503), nothing is assumed
 *   'NONE'     the operator has explicitly waived it
 *   other      the consent code that must be accepted, at its current version, for the photo's registration
 */
export type BiometricConsentPolicy = string | undefined;

export const WAIVED_CONSENT = 'NONE';
