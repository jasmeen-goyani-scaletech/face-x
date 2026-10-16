import { z } from 'zod';

/** `Authorization: Bearer <token>`: exactly two parts, token limited to JWT characters. */
export const bearerHeaderSchema = z
  .string()
  .max(8192)
  .regex(/^Bearer [A-Za-z0-9\-._~+/]+=*$/);

export const eventIdParamSchema = z.uuid();

const email = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email())
  .transform((v) => v.toLowerCase());

/** Upper bound stops absurdly long inputs being fed to the password hash (CPU/memory abuse). */
export const registerBodySchema = z.object({
  email,
  password: z.string().min(10, 'must be at least 10 characters').max(128),
  fullName: z.string().trim().min(1).max(120).optional(),
});

export const loginBodySchema = z.object({
  email,
  password: z.string().min(1).max(128),
});

/** The token from an admin-issued sign-in link (same shape as a refresh token: 32 random bytes, base64url). */
export const signInLinkBodySchema = z.object({ token: z.string().min(20).max(100) });

/** A visitor filling in a public registration form: the contact email plus the role they register as (never ADMIN). */
export const guestBodySchema = z.object({
  email,
  fullName: z.string().trim().min(1).max(120).optional(),
  role: z.enum(['PARENT', 'PLAYER', 'COACH', 'STAFF']),
});
