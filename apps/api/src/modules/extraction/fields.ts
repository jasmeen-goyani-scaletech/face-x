import type { FieldSpec as ProviderFieldSpec } from '../../infrastructure/extraction/document-extractor';
import type { DocumentType } from '../documents/types';

/**
 * What the profile on record a field is checked against:
 *  - firstName / lastName  the profile's first / last name (players and staff alike);
 *  - fullName              every part of the profile's first and last name appears in the printed full name;
 *  - dateOfBirth           the player's date of birth;
 *  - notExpired            the printed expiry date is on or after the event's (local) start date.
 */
export type CompareTo = 'firstName' | 'lastName' | 'fullName' | 'dateOfBirth' | 'notExpired';

export interface FieldSpec extends ProviderFieldSpec {
  compareTo?: CompareTo;
}

const IDENTITY_FIELDS: readonly FieldSpec[] = [
  {
    key: 'firstName',
    kind: 'name',
    description: "The person's first (given) name",
    compareTo: 'firstName',
  },
  { key: 'middleName', kind: 'name', description: "The person's middle name(s), if printed" },
  {
    key: 'lastName',
    kind: 'name',
    description: "The person's last (family) name",
    compareTo: 'lastName',
  },
  {
    key: 'fullName',
    kind: 'name',
    description: "The person's full name exactly as printed",
    compareTo: 'fullName',
  },
  {
    key: 'dateOfBirth',
    kind: 'date',
    description: "The person's date of birth",
    compareTo: 'dateOfBirth',
  },
];

const CERTIFICATE_FIELDS: readonly FieldSpec[] = [
  {
    key: 'fullName',
    kind: 'name',
    description: 'The full name of the person the document was issued to',
    compareTo: 'fullName',
  },
  {
    key: 'issueDate',
    kind: 'date',
    description: 'The date the certificate or check was issued or completed',
  },
  {
    key: 'expiryDate',
    kind: 'date',
    description: 'The date the certificate or check expires or must be renewed',
    compareTo: 'notExpired',
  },
  {
    key: 'issuer',
    kind: 'text',
    description: 'The organization that issued the certificate or ran the check',
  },
];

/**
 * The fields read off each document type. Age is not asked for: it is computed from dateOfBirth at the event date,
 * because a printed age (e.g. on a transcript) goes stale. An empty list means the type is not extractable.
 */
export const EXTRACTION_FIELDS: Record<DocumentType, readonly FieldSpec[]> = {
  BIRTH_CERTIFICATE: IDENTITY_FIELDS,
  CALIFORNIA_KID_ID: IDENTITY_FIELDS,
  SCHOOL_TRANSCRIPT: IDENTITY_FIELDS,
  SCHOOL_ID: [
    {
      key: 'fullName',
      kind: 'name',
      description: "The student's full name as printed",
      compareTo: 'fullName',
    },
    { key: 'studentId', kind: 'text', description: 'The student ID number' },
    { key: 'schoolName', kind: 'text', description: 'The name of the school' },
    {
      key: 'schoolYear',
      kind: 'text',
      description: 'The school year or validity period printed on the card',
    },
  ],
  FIRST_AID_CPR: CERTIFICATE_FIELDS,
  YALF_TACKLE: CERTIFICATE_FIELDS,
  SAFESPORT: CERTIFICATE_FIELDS,
  BACKGROUND_CHECK: CERTIFICATE_FIELDS,
  PROFILE_PHOTO: [],
};
