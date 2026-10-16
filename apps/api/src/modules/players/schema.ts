import { z } from 'zod';
import { emailField, isoDateOfBirth, personName, usPhone } from '../../shared/validation/fields';
import { AGE_DIVISIONS } from './types';

const relationship = z.string().trim().min(1, 'is required').max(40);
const schoolId = z.string().trim().min(1).max(50);

/**
 * All body schemas are strict: unknown fields (e.g. `userId`, `status`, `createdBy`) are rejected with 422
 * instead of being silently dropped, so a client can never believe it set something it did not.
 */
export const guardianInputSchema = z
  .object({
    relationship,
    // Create the caller's own guardian record the first time (required then, checked in the service); on later children, whatever is
    // sent here updates that record.
    firstName: personName.optional(),
    lastName: personName.optional(),
    phone: usPhone.optional(),
  })
  .strict();

export const createPlayerBodySchema = z
  .object({
    firstName: personName,
    lastName: personName,
    dateOfBirth: isoDateOfBirth,
    email: emailField.optional(),
    phone: usPhone.optional(),
    schoolId: schoolId.optional(),
    /** The bracket the player plays in. No longer asked for at registration; still accepted. */
    ageDivision: z.enum(AGE_DIVISIONS).optional(),
    /** true = the caller IS the player (PLAYER role); false/absent = the caller registers a child (PARENT role). */
    forSelf: z.boolean().optional(),
    guardian: guardianInputSchema.optional(),
  })
  .strict();

export const updatePlayerBodySchema = z
  .object({
    firstName: personName.optional(),
    lastName: personName.optional(),
    dateOfBirth: isoDateOfBirth.optional(),
    email: emailField.nullable().optional(),
    phone: usPhone.nullable().optional(),
    schoolId: schoolId.nullable().optional(),
    ageDivision: z.enum(AGE_DIVISIONS).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'at least one field is required');

export const addGuardianBodySchema = z
  .object({
    firstName: personName,
    lastName: personName,
    email: emailField,
    phone: usPhone.optional(),
    relationship,
  })
  .strict();

export type CreatePlayerBody = z.infer<typeof createPlayerBodySchema>;
export type UpdatePlayerBody = z.infer<typeof updatePlayerBodySchema>;
export type AddGuardianBody = z.infer<typeof addGuardianBodySchema>;
