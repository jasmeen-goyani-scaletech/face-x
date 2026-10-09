import { z } from 'zod';
import { uuid } from '../../shared/validation/fields';

/**
 * `accepted` must be the literal `true`: the database records acceptances only (there is no "declined" state),
 * so a refusal is simply "no record". Strict: nothing else can be supplied (not the version text, ip, or time).
 */
export const recordConsentBodySchema = z
  .object({
    consentId: uuid,
    signedName: z.string().trim().min(2, 'must be at least 2 characters').max(120),
    accepted: z.literal(true),
  })
  .strict();

export type RecordConsentBody = z.infer<typeof recordConsentBodySchema>;
