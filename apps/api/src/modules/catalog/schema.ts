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

/**
 * GET /events: with neither `page` nor `pageSize` it is the plain list it always was (the first 100 events); with either it is
 * one page, so a picker can read every open event however many there are. Both are optional, without defaults, so their absence
 * can be told apart. Not strict: this endpoint has always ignored query parameters it does not know, and still does.
 */
export const listEventsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export type ResolveInviteBody = z.infer<typeof resolveInviteBodySchema>;
