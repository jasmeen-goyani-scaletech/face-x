import { z } from 'zod';

/** Field validators shared by the player, parent and registration schemas (mirror the frontend's rules). */

export const uuid = z.uuid();

export const personName = z.string().trim().min(1, 'is required').max(80);

export const emailField = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email())
  .transform((v) => v.toLowerCase());

/** US phone as in the frontend: 10 digits, or 11 with a leading 1; only digits, spaces and + ( ) . - allowed. */
export const usPhone = z
  .string()
  .trim()
  .max(30)
  .refine((v) => {
    if (!/^[+\d\s().-]+$/.test(v)) return false;
    const digits = v.replace(/\D/g, '');
    return digits.length === 10 || (digits.length === 11 && digits.startsWith('1'));
  }, 'must be a valid 10-digit phone number');

const todayUtc = () => new Date().toISOString().slice(0, 10);

/** A real calendar date `YYYY-MM-DD`, not in the future, not before 1900. */
export const isoDateOfBirth = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date as YYYY-MM-DD')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'is not a real calendar date')
  .refine((v) => v >= '1900-01-01', 'is too far in the past')
  .refine((v) => v <= todayUtc(), 'cannot be in the future');
