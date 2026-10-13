import { z } from 'zod';
import { emailField, personName, usPhone } from '../../shared/validation/fields';
import { STAFF_PROFILE_TYPES, STAFF_ROLES } from './types';

/**
 * Strict, like every body schema: `userId` and anything else the client might try to set is rejected, never ignored.
 * A STAFF profile needs its administrative role and a COACH profile must not have one (mirrors the table's check).
 */
export const createStaffProfileBodySchema = z
  .object({
    profileType: z.enum(STAFF_PROFILE_TYPES),
    staffRole: z.enum(STAFF_ROLES).optional(),
    firstName: personName,
    lastName: personName,
    email: emailField,
    phone: usPhone.optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.profileType === 'STAFF' && !b.staffRole) {
      ctx.addIssue({ code: 'custom', path: ['staffRole'], message: 'is required for staff' });
    }
    if (b.profileType === 'COACH' && b.staffRole) {
      ctx.addIssue({ code: 'custom', path: ['staffRole'], message: 'is not allowed for a coach' });
    }
  });

export const updateStaffProfileBodySchema = z
  .object({
    staffRole: z.enum(STAFF_ROLES).optional(),
    firstName: personName.optional(),
    lastName: personName.optional(),
    email: emailField.optional(),
    phone: usPhone.nullable().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'at least one field is required');

export type CreateStaffProfileBody = z.infer<typeof createStaffProfileBodySchema>;
export type UpdateStaffProfileBody = z.infer<typeof updateStaffProfileBodySchema>;
