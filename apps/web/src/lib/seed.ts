/** One person on the event-day roster, as the door screens show them (built from the API's roster, see lib/admin/useApiRoster.ts). */
export interface RosterEntry {
  id: string;
  firstName: string;
  lastName: string;
  dob: string;
  schoolId: string;
  role: 'player' | 'coach' | 'staff';
  teamName: string;
  division: string;
  /** The person's own mobile. Empty when none is on file (a young player may not have one). */
  phone: string;
  /** Contact email when one is on file; searchable offline. */
  email?: string;
  /** A minor's parent / guardian mobile. Empty for adults and when none is on file. */
  parentPhone: string;
  /** The team's id (not just its name), so a coach's roster can be matched to exactly one team. */
  teamId: string;
  /** Not collected at registration yet; empty for real registrants. */
  jerseyNumber: string;
  position: string;
  /** The parent / guardian to contact for a minor. */
  guardianName: string;
  photoUrl: string;
  /** The API document to ask a viewing link for (the photo is fetched when it is about to be shown). */
  photoDocumentId?: string;
  approved: boolean; // false = not on the eligible list at all; check-in is fully blocked, no override
  paymentComplete: boolean;
  flags: string[]; // soft-blocker warnings on an otherwise-approved registrant; admin can override
  pendingReason: string;
  disabled: boolean; // admin-toggled event-day access block, independent of document/payment approval
  checkedInAt: number | null;
  checkedInMethod: string | null;
  checkedInOverride: boolean;
  /** Checked in on THIS device but not yet acknowledged by the server: saved locally, waiting to sync. */
  pendingSync?: boolean;
}
