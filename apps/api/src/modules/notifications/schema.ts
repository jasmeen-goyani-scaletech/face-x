import { z } from 'zod';

/** Push services hand out https endpoints; anything else is refused. */
const endpoint = z
  .url()
  .max(2048)
  .refine((v) => v.startsWith('https://'), 'must be an https URL');

export const subscribeBodySchema = z
  .object({
    endpoint,
    keys: z.object({
      p256dh: z.string().trim().min(1).max(512),
      auth: z.string().trim().min(1).max(512),
    }),
  })
  .strict();

export const unsubscribeBodySchema = z.object({ endpoint }).strict();
