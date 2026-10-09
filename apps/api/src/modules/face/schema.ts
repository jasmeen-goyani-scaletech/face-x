import { z } from 'zod';
import { uuid } from '../../shared/validation/fields';

/**
 * Enrollment names the registration photo to enroll from. Strict: the client can never supply an image, a
 * provider reference, a provider name or a score.
 */
export const enrollBodySchema = z.object({ documentId: uuid }).strict();

export type EnrollBody = z.infer<typeof enrollBodySchema>;
