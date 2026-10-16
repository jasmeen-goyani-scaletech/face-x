import { z } from 'zod';
import { DOCUMENT_TYPES, REJECTION_REASON_CODES } from './types';

/** Keeps only the file's own name: no path, no control characters, bounded length. Metadata only, never part of a key. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '').trim();
  return cleaned.slice(0, 150);
}

/** Strict, like every body schema: the client can never supply a storage key, bucket or status. */
export const requestUploadBodySchema = z
  .object({
    // Any known type here; the service checks it is one this kind of registration may hold.
    documentType: z.enum(DOCUMENT_TYPES),
    fileName: z
      .string()
      .max(255)
      .transform(sanitizeFileName)
      .pipe(z.string().min(1, 'is required')),
    mimeType: z.string().trim().min(1).max(100),
    sizeBytes: z.number().int().positive(),
  })
  .strict();

/**
 * Submitting sends the document to review. `aiRejected` is the client's report that the AI check turned the document down on the
 * family's second attempt; it only ever adds scrutiny (the reviewer is told to look by eye), so it needs no proof.
 */
export const submitBodySchema = z.object({ aiRejected: z.boolean().optional() }).strict();

export const reviewBodySchema = z.discriminatedUnion('decision', [
  z
    .object({
      decision: z.literal('APPROVED'),
      notes: z.string().trim().min(1).max(1000).optional(),
    })
    .strict(),
  z
    .object({
      decision: z.literal('REJECTED'),
      reasonCode: z.enum(REJECTION_REASON_CODES),
      reason: z.string().trim().min(1, 'is required when rejecting').max(500),
      notes: z.string().trim().min(1).max(1000).optional(),
    })
    .strict(),
]);

export type RequestUploadBody = z.infer<typeof requestUploadBodySchema>;
export type SubmitBody = z.infer<typeof submitBodySchema>;
export type ReviewBody = z.infer<typeof reviewBodySchema>;
