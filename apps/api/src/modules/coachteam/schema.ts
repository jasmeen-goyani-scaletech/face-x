import { z } from 'zod';

/**
 * Strict, like every body. The coach names the team; the club defaults to the team's name (the form only asks for a name) and
 * the division to "Open". The event, the coach and the invite code are never taken from the client.
 */
export const createCoachTeamBodySchema = z
  .object({
    name: z.string().trim().min(1, 'is required').max(80),
    club: z.string().trim().max(80).optional(),
    division: z.string().trim().min(1).max(20).optional(),
  })
  .strict();

export type CreateCoachTeamBody = z.infer<typeof createCoachTeamBodySchema>;
