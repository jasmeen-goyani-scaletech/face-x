import { z } from 'zod';
import { uuid } from '../../shared/validation/fields';

/** The code is secret, so it travels in a POST body (never a URL or a log line). Case-insensitive. */
export const resolveInviteBodySchema = z
  .object({
    inviteCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{4,32}$/, 'is not a valid invite code'),
    /** The invite link carries both; when given, the code must belong to exactly this team. */
    teamId: uuid.optional(),
  })
  .strict();

export type ResolveInviteBody = z.infer<typeof resolveInviteBodySchema>;
