import type { EligibilityReason } from './eligibility';
import type { ReviewReason } from './matching';

/** The person a scan or check-in is about: event-scoped and minimal. No date of birth, contact or guardian data. */
export interface ScanPersonDto {
  registrationId: string;
  registrationNumber: string;
  firstName: string;
  lastName: string;
}

/** What REVIEW_REQUIRED shows: enough for an operator to pick the right person, with the surname shortened. */
export interface ReviewCandidateDto {
  registrationId: string;
  registrationNumber: string;
  displayName: string;
}

/** The result of a scan. Scores, provider references and candidate lists beyond a few review names are never returned. */
export type FaceScanResultDto =
  | {
      scanId: string;
      result: 'MATCH';
      /** The scan can be used for one check-in until this time. */
      expiresAt: string;
      registration: ScanPersonDto;
      alreadyCheckedIn: boolean;
    }
  | {
      scanId: string;
      result: 'REVIEW_REQUIRED';
      reason: ReviewReason;
      /** Only for NOT_ELIGIBLE: structured codes, nothing personal. */
      eligibility?: EligibilityReason[];
      candidates: ReviewCandidateDto[];
    }
  | { scanId: string; result: 'NO_MATCH' };

export interface CheckInDto {
  checkInId: string;
  registrationId: string;
  registrationNumber: string;
  method: 'FACE' | 'MANUAL';
  checkedInAt: string;
}

export interface SearchResultDto {
  registrationId: string;
  registrationNumber: string;
  registrantType: 'PLAYER' | 'COACH' | 'STAFF';
  firstName: string;
  lastName: string;
  teamName: string | null;
  /** READY_FOR_EVENT with access enabled. A hint only: eligibility is re-checked at check-in. */
  ready: boolean;
  checkedIn: boolean;
}
