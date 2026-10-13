import { z } from 'zod';
import { uuid } from '../../shared/validation/fields';

/**
 * Optional, for check-ins made on a device that may have been offline: which device, and when IT recorded the check-in. They are
 * kept in the audit record only. The check-in's own time (`checkedInAt`) is always the server's clock, so a wrong device clock
 * cannot reorder or backdate anything, and nothing here decides who was first.
 */
const deviceFields = {
  deviceId: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, 'may only contain letters, digits, - and _')
    .optional(),
  deviceCheckedInAt: z.iso
    .datetime({ offset: true, message: 'must be a date and time' })
    .optional(),
};

/**
 * Check-in bodies are strict. A FACE check-in names only the scan: the client can never say WHO was recognized.
 * `clientRequestId` is generated once per attempt and resent unchanged on a retry (idempotency).
 */
export const checkInBodySchema = z.discriminatedUnion('method', [
  z
    .object({ method: z.literal('FACE'), scanId: uuid, clientRequestId: uuid, ...deviceFields })
    .strict(),
  z
    .object({
      method: z.literal('MANUAL'),
      registrationId: uuid,
      clientRequestId: uuid,
      ...deviceFields,
    })
    .strict(),
]);
export type CheckInBody = z.infer<typeof checkInBodySchema>;

export const MIN_SEARCH_LENGTH = 3;
export const searchQuerySchema = z
  .object({ q: z.string().trim().min(MIN_SEARCH_LENGTH).max(80) })
  .strict();

export type SearchKind = 'DATE_OF_BIRTH' | 'REGISTRATION_NUMBER' | 'TEXT';

/** Decides how a search term is matched. Exact for identifiers, prefix for names; never fuzzy. */
export function classifySearch(term: string): { kind: SearchKind; value: string } {
  // An impossible date (2014-13-45) is plain text that matches nothing; it must never reach the date cast.
  if (/^\d{4}-\d{2}-\d{2}$/.test(term) && isRealDate(term))
    return { kind: 'DATE_OF_BIRTH', value: term };
  if (/^FX-\d{4}-\d{5}$/i.test(term))
    return { kind: 'REGISTRATION_NUMBER', value: term.toUpperCase() };
  return { kind: 'TEXT', value: term };
}

function isRealDate(value: string): boolean {
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
