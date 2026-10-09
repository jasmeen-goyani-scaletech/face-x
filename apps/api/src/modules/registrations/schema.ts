import { z } from 'zod';
import { uuid } from '../../shared/validation/fields';
import { REGISTRANT_TYPES } from './transitions';

// The frontend allows 0 to 10 guests (src/lib/guardianValidation.ts).
const guestCount = z.number().int().min(0).max(10);

/**
 * Strict: `status`, `registrantType`, `createdBy` etc. are rejected, never silently ignored. Exactly one registrant is
 * named: a player (`playerId`, optionally with `guestCount`) or a coach/staff member (`staffProfileId`). Which of the two
 * it is follows from the id, and the service checks the caller owns it.
 */
export const createRegistrationBodySchema = z
  .object({
    eventId: uuid,
    playerId: uuid.optional(),
    staffProfileId: uuid.optional(),
    teamId: uuid.optional(),
    guestCount: guestCount.optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (!b.playerId === !b.staffProfileId) {
      ctx.addIssue({
        code: 'custom',
        path: [b.playerId ? 'staffProfileId' : 'playerId'],
        message: 'exactly one of playerId or staffProfileId is required',
      });
    }
    if (b.staffProfileId && b.guestCount !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['guestCount'],
        message: 'is only for player registrations',
      });
    }
  });

export const updateRegistrationBodySchema = z
  .object({
    teamId: uuid.nullable().optional(),
    guestCount: guestCount.optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'at least one field is required');

/**
 * Optional narrowing of the caller's own registrations, e.g. "does this player already have one for this event?".
 * Without `registrantType` the list is the caller's PLAYER registrations (what it always returned); a coach or staff
 * member asks for their own with `registrantType=COACH|STAFF`.
 */
export const listRegistrationsQuerySchema = z
  .object({
    eventId: uuid.optional(),
    playerId: uuid.optional(),
    staffProfileId: uuid.optional(),
    registrantType: z.enum(REGISTRANT_TYPES).optional(),
  })
  .strict();

export type ListRegistrationsQuery = z.infer<typeof listRegistrationsQuerySchema>;
export type CreateRegistrationBody = z.infer<typeof createRegistrationBodySchema>;
export type UpdateRegistrationBody = z.infer<typeof updateRegistrationBodySchema>;
