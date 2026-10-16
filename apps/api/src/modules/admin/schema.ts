import { z } from 'zod';
import { uuid } from '../../shared/validation/fields';
import { REGISTRANT_TYPES, REGISTRATION_STATUSES } from '../registrations/transitions';

const page = z.coerce.number().int().min(1).max(100_000).default(1);
const pageSize = z.coerce.number().int().min(1).max(100).default(25);

/** Strict, like every request schema: an unknown filter is a 422, never silently ignored. */
export const listRegistrationsQuerySchema = z
  .object({
    /** A registration status, or `flagged`: registrations with a document the AI check turned down or an admin rejected. */
    status: z
      .preprocess(
        (v) => (typeof v === 'string' ? v.toUpperCase() : v),
        z.enum([...REGISTRATION_STATUSES, 'FLAGGED']),
      )
      .optional(),
    /** `true`: only registrations with a document the AI check turned down (the family was not told). */
    aiRejected: z.enum(['true', 'false']).optional(),
    /** `true`: only registrations whose event-day access an admin switched off. */
    eventAccessDisabled: z.enum(['true', 'false']).optional(),
    teamId: uuid.optional(),
    /** Player name or registration number. */
    search: z.string().trim().min(1).max(100).optional(),
    /** `true`: only registrations that have documents waiting for review. */
    documentsPending: z.enum(['true', 'false']).optional(),
    /** Whose registrations: the list is PLAYER registrations unless COACH or STAFF is asked for. */
    registrantType: z.enum(REGISTRANT_TYPES).default('PLAYER'),
    page,
    pageSize,
  })
  .strict();

/** Which kind of registration a summary counts (PLAYER unless asked otherwise). */
export const summaryQuerySchema = z
  .object({ registrantType: z.enum(REGISTRANT_TYPES).default('PLAYER') })
  .strict();

/**
 * GET /admin/events/:id/roster: with neither `page` nor `pageSize` it is the whole roster (a plain array, as ever); with either
 * it is one page, up to ROSTER_PAGE_MAX people. A device that holds the roster for the day reads it page by page, so no roster
 * is ever silently cut short.
 */
export const ROSTER_PAGE_MAX = 500;
export const rosterQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100_000).optional(),
    pageSize: z.coerce.number().int().min(1).max(ROSTER_PAGE_MAX).optional(),
  })
  .strict();

export const reviewQueueQuerySchema = z.object({ page, pageSize }).strict();

/** One page of the organization's teams, across all its events. */
export const listTeamsQuerySchema = z.object({ page, pageSize }).strict();

/**
 * GET /admin/events: with neither `page` nor `pageSize` it is the plain list the event pickers need; with either it is one
 * page. Both are optional here (no defaults) so that their absence can be told apart.
 */
export const listEventsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100_000).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export const rejectRegistrationBodySchema = z
  .object({
    /** Shown to the family (it is part of the registration's status history), so it must be written for them. */
    reason: z.string().trim().min(1, 'is required').max(500),
  })
  .strict();

/**
 * Switch a person's event-day access off or on. A reason is optional when disabling (it is kept for the audit trail and
 * for other admins); it is dropped when enabling. Strict, like every body: nothing else can be supplied.
 */
export const eventAccessBodySchema = z
  .object({
    disabled: z.boolean(),
    reason: z.string().trim().min(1, 'cannot be empty').max(500).optional(),
  })
  .strict()
  .refine((b) => b.disabled || b.reason === undefined, {
    path: ['reason'],
    message: 'is only allowed when disabling access',
  });

export type ListRegistrationsQuery = z.infer<typeof listRegistrationsQuerySchema>;
export type ListTeamsQuery = z.infer<typeof listTeamsQuerySchema>;
export type ReviewQueueQuery = z.infer<typeof reviewQueueQuerySchema>;
export type EventAccessBody = z.infer<typeof eventAccessBodySchema>;
export type RejectRegistrationBody = z.infer<typeof rejectRegistrationBodySchema>;

/** An IANA time zone name the runtime knows (e.g. America/Los_Angeles). */
const timeZone = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'must be a valid IANA time zone, e.g. America/Los_Angeles');

const instant = z.iso.datetime({
  offset: true,
  message: 'must be a date and time, e.g. 2026-11-14T17:30:00-08:00',
});
const EVENT_STATUSES = ['DRAFT', 'PUBLISHED', 'CLOSED'] as const;

/** Strict, like every body: `organizationId`, `createdBy` and the like are rejected, never silently dropped. */
export const createEventBodySchema = z
  .object({
    name: z.string().trim().min(1, 'is required').max(120),
    description: z.string().trim().max(2000).nullable().optional(),
    location: z.string().trim().min(1, 'is required').max(200),
    timezone: timeZone,
    startsAt: instant,
    endsAt: instant,
    /** What a player pays, in cents. Coaches and staff never pay. */
    feeCents: z.number().int().min(0).max(1_000_000).optional(),
    status: z.enum(EVENT_STATUSES).optional(),
  })
  .strict()
  .refine((b) => new Date(b.endsAt) >= new Date(b.startsAt), {
    path: ['endsAt'],
    message: 'cannot be before the start',
  });

export const updateEventBodySchema = z
  .object({
    name: z.string().trim().min(1, 'is required').max(120).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    location: z.string().trim().min(1, 'is required').max(200).optional(),
    timezone: timeZone.optional(),
    startsAt: instant.optional(),
    endsAt: instant.optional(),
    feeCents: z.number().int().min(0).max(1_000_000).optional(),
    status: z.enum(EVENT_STATUSES).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'at least one field is required');

export const createTeamBodySchema = z
  .object({
    name: z.string().trim().min(1, 'is required').max(80),
    club: z.string().trim().max(80).optional(),
    division: z.string().trim().min(1, 'is required').max(20),
  })
  .strict();

export const updateTeamBodySchema = z
  .object({
    name: z.string().trim().min(1, 'is required').max(80).optional(),
    club: z.string().trim().max(80).optional(),
    division: z.string().trim().min(1, 'is required').max(20).optional(),
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
    /** A positive whole number sets the limit; null removes it (unlimited). Omit to leave it as it is. */
    maxPlayers: z.number().int().min(1).max(100_000).nullable().optional(),
    maxCoaches: z.number().int().min(1).max(100_000).nullable().optional(),
    maxStaff: z.number().int().min(1).max(100_000).nullable().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'at least one field is required');

export const assignTeamBodySchema = z.object({ teamId: uuid }).strict();
export type AssignTeamBody = z.infer<typeof assignTeamBodySchema>;

export type SummaryQuery = z.infer<typeof summaryQuerySchema>;
export type CreateEventBody = z.infer<typeof createEventBodySchema>;
export type UpdateEventBody = z.infer<typeof updateEventBodySchema>;
export type CreateTeamBody = z.infer<typeof createTeamBodySchema>;
export type UpdateTeamBody = z.infer<typeof updateTeamBodySchema>;
