/**
 * Consent codes that can be recorded against a registration, by who is registering. Deliberately small: the biometric
 * (face-scan) consent is added with the face phase. The wording of every consent lives in the database (`consents`),
 * published by the client; nothing in the code defines or implies legal text.
 *   PLAYER  GUARDIAN_CONSENT (required when the player is a minor on the event date)
 *   COACH   AB506_ACKNOWLEDGEMENT (the California Child Abuse Prevention Act acknowledgement; always required)
 *   STAFF   none
 */
export const PLAYER_REGISTRATION_CONSENT_CODES = ['GUARDIAN_CONSENT'] as const;
export const COACH_REGISTRATION_CONSENT_CODES = ['AB506_ACKNOWLEDGEMENT'] as const;
export type ConsentCode =
  | (typeof PLAYER_REGISTRATION_CONSENT_CODES)[number]
  | (typeof COACH_REGISTRATION_CONSENT_CODES)[number];

export type ConsentRegistrantType = 'PLAYER' | 'COACH' | 'STAFF';
export const CONSENT_CODES_FOR: Record<ConsentRegistrantType, readonly ConsentCode[]> = {
  PLAYER: PLAYER_REGISTRATION_CONSENT_CODES,
  COACH: COACH_REGISTRATION_CONSENT_CODES,
  STAFF: [],
};
/** Every consent a registration of any kind can need (what `GET /consents/current` lists). */
export const ALL_REGISTRATION_CONSENT_CODES: readonly ConsentCode[] = [
  ...PLAYER_REGISTRATION_CONSENT_CODES,
  ...COACH_REGISTRATION_CONSENT_CODES,
];

export interface ConsentVersionDto {
  id: string;
  code: string;
  version: number;
  title: string;
  body: string;
  effectiveAt: string;
}

export interface ConsentRecordDto {
  id: string;
  consentId: string;
  code: string;
  version: number;
  acceptedAt: string;
  signedName: string;
  /** Who signed: a guardian linked to the player, the player themself, or a coach/staff member (SELF). */
  signedBy: 'GUARDIAN' | 'PLAYER' | 'SELF';
  /** True when this is the newest published version of its consent. */
  currentVersion: boolean;
}

export interface ConsentRequirementDto {
  code: string;
  /** Required for this registration (guardian consent: when the player is under 18 on the event date; AB 506: coaches). */
  required: boolean;
  /** The version a family would accept now. Null until the client has published the wording. */
  current: ConsentVersionDto | null;
  /** The current version has been accepted for this registration. */
  accepted: boolean;
}

/** Consent state of a registration. Separate from the registration status, which it never changes. */
export interface ConsentStatusDto {
  registrationId: string;
  requirements: ConsentRequirementDto[];
  /** Every acceptance ever recorded, including older versions. Records are never edited or removed. */
  records: ConsentRecordDto[];
}
