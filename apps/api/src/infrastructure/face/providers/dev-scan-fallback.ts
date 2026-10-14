import type { Queryable } from '../../database/database';
import { FaceProviderError, type FaceRecognitionProvider } from '../face-provider';

/**
 * DEVELOPMENT ONLY (FACE_SCAN_MOCK=true; env validation refuses it in production). When the real provider cannot answer a scan
 * (it refused the frame, found no face, or was unreachable), answer with a confident match on a person who is enrolled and
 * registered for the event, so the rest of the check-in flow can be tested. Enrollment, removal and a scan the provider
 * answers (match or no match) are untouched. Never a substitute for recognition.
 */
export function withDevScanFallback(
  inner: FaceRecognitionProvider,
  db: Queryable,
  warn: (msg: string, detail: Record<string, unknown>) => void = (m, d) => console.warn(m, d),
): FaceRecognitionProvider {
  return {
    ...inner,
    name: inner.name,
    enroll: (r) => inner.enroll(r),
    remove: (ref, o) => inner.remove(ref, o),
    verify: (r) => inner.verify(r),
    async identify(request) {
      try {
        return await inner.identify(request);
      } catch (err) {
        if (!(err instanceof FaceProviderError)) throw err;
        const { rows } = await db.query<{ reference: string }>(
          `select fp.provider_profile_id as reference
             from public.face_profiles fp
            where fp.provider = $1 and fp.status = 'ACTIVE'
              and exists (select 1 from public.registrations r
                           where r.event_id = $2
                             and (r.player_id = fp.player_id or r.staff_profile_id = fp.staff_profile_id))
            order by fp.created_at desc
            limit 1`,
          [inner.name, request.eventId ?? null],
        );
        const reference = rows[0]?.reference;
        if (!reference) throw err;
        warn('FACE_SCAN_MOCK: provider failed, returning the newest enrolled person as a match', {
          providerError: err.code,
          reason: err.message,
        });
        return { candidates: [{ reference, similarity: 0.99 }], scanImageUrl: null };
      }
    },
  };
}
