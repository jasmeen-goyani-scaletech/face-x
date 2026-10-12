import type { Database, Queryable } from '../../infrastructure/database/database';
import type { RequestMeta } from '../../shared/http/request-meta';
import { recordAudit, type AuditAction } from '../audit';
import { checkEligibility, type EligibilityInput, type EligibilityResult } from './eligibility';
import { classifySearch } from './schema';
import type { CheckInDto, SearchResultDto } from './types';

/** An event-scoped scan candidate: a provider reference resolved to an ACTIVE profile registered for THIS event. */
export interface ResolvedCandidate {
  similarity: number;
  faceProfileId: string;
  registrationId: string;
  registrationNumber: string;
  playerId: string;
  firstName: string;
  lastName: string;
}

export interface ScanRow {
  id: string;
  eventId: string;
  scannedBy: string;
  result: string;
  matchedPlayerId: string | null;
  faceProfileId: string | null;
  /** Seconds since the scan was recorded, by the database clock. */
  ageSeconds: number;
}

export interface CheckInRow extends CheckInDto {
  eventId: string;
  checkedInBy: string;
  faceScanId: string | null;
}

const SEARCH_LIMIT = 20;
export const SEARCH_RESULT_LIMIT = SEARCH_LIMIT;

function bind(q: Queryable) {
  return {
    /** Maps provider references to profiles that are ACTIVE and registered for this event. Anything else is dropped. */
    async resolveCandidates(
      eventId: string,
      provider: string,
      scored: readonly { reference: string; similarity: number }[],
    ): Promise<ResolvedCandidate[]> {
      if (scored.length === 0) return [];
      const { rows } = await q.query<{
        reference: string;
        face_profile_id: string;
        registration_id: string;
        registration_number: string;
        player_id: string;
        first_name: string;
        last_name: string;
      }>(
        `select fp.provider_profile_id as reference, fp.id as face_profile_id, r.id as registration_id,
                r.registration_number, pl.id as player_id, pl.first_name, pl.last_name
           from public.face_profiles fp
           join public.players pl on pl.id = fp.player_id
           join public.registrations r
             on r.player_id = pl.id and r.event_id = $1 and r.registrant_type = 'PLAYER'
          where fp.provider = $2 and fp.status = 'ACTIVE' and fp.provider_profile_id = any($3::text[])`,
        [eventId, provider, scored.map((c) => c.reference)],
      );
      const byReference = new Map(scored.map((c) => [c.reference, c.similarity]));
      return rows.map((r) => ({
        similarity: byReference.get(r.reference) ?? 0,
        faceProfileId: r.face_profile_id,
        registrationId: r.registration_id,
        registrationNumber: r.registration_number,
        playerId: r.player_id,
        firstName: r.first_name,
        lastName: r.last_name,
      }));
    },

    async isCheckedIn(registrationId: string): Promise<boolean> {
      const { rows } = await q.query('select 1 from public.check_ins where registration_id = $1', [
        registrationId,
      ]);
      return rows.length > 0;
    },

    eligibility(input: EligibilityInput, options?: { lock?: boolean }): Promise<EligibilityResult> {
      return checkEligibility(q, input, options);
    },

    /** Records the scan outcome: only the existing minimal metadata, never an image, template or candidate list. */
    async insertScan(input: {
      eventId: string;
      scannedBy: string;
      result: 'MATCH' | 'NO_MATCH' | 'REVIEW_REQUIRED' | 'ERROR';
      provider: string;
      matchedPlayerId?: string | null;
      faceProfileId?: string | null;
      score?: number | null;
      reasonCode?: string | null;
    }): Promise<string> {
      const { rows } = await q.query<{ id: string }>(
        `insert into public.face_scans
           (event_id, scanned_by, result, matched_player_id, face_profile_id, provider, provider_score, error_code)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [
          input.eventId,
          input.scannedBy,
          input.result,
          input.matchedPlayerId ?? null,
          input.faceProfileId ?? null,
          input.provider,
          input.score ?? null,
          input.reasonCode ?? null,
        ],
      );
      return rows[0]!.id;
    },

    /** Row-locks the scan, so two requests using the same scan are serialized. */
    async lockScan(scanId: string): Promise<ScanRow | null> {
      const { rows } = await q.query<{
        id: string;
        event_id: string;
        scanned_by: string;
        result: string;
        matched_player_id: string | null;
        face_profile_id: string | null;
        age: string;
      }>(
        `select id, event_id, scanned_by, result, matched_player_id, face_profile_id,
                extract(epoch from (now() - created_at))::text as age
           from public.face_scans where id = $1 for update`,
        [scanId],
      );
      const r = rows[0];
      return r
        ? {
            id: r.id,
            eventId: r.event_id,
            scannedBy: r.scanned_by,
            result: r.result,
            matchedPlayerId: r.matched_player_id,
            faceProfileId: r.face_profile_id,
            ageSeconds: Number(r.age),
          }
        : null;
    },

    async findPlayerRegistrationId(eventId: string, playerId: string): Promise<string | null> {
      const { rows } = await q.query<{ id: string }>(
        `select id from public.registrations
          where event_id = $1 and player_id = $2 and registrant_type = 'PLAYER'`,
        [eventId, playerId],
      );
      return rows[0]?.id ?? null;
    },

    /** Inserts the check-in, or returns null when ANY unique rule already holds (registration, scan, request id). */
    async insertCheckIn(input: {
      eventId: string;
      registrationId: string;
      method: 'FACE' | 'MANUAL';
      faceScanId: string | null;
      checkedInBy: string;
      clientRequestId: string;
    }): Promise<string | null> {
      const { rows } = await q.query<{ id: string }>(
        `insert into public.check_ins
           (event_id, registration_id, method, face_scan_id, checked_in_by, client_request_id)
         values ($1, $2, $3, $4, $5, $6)
         on conflict do nothing
         returning id`,
        [
          input.eventId,
          input.registrationId,
          input.method,
          input.faceScanId,
          input.checkedInBy,
          input.clientRequestId,
        ],
      );
      return rows[0]?.id ?? null;
    },

    findCheckInByRequestId: (clientRequestId: string) =>
      findCheckIn(q, 'c.client_request_id', clientRequestId),
    findCheckInByScan: (scanId: string) => findCheckIn(q, 'c.face_scan_id', scanId),
    findCheckInByRegistration: (registrationId: string) =>
      findCheckIn(q, 'c.registration_id', registrationId),

    async search(
      eventId: string,
      term: string,
    ): Promise<{ results: SearchResultDto[]; truncated: boolean }> {
      const { kind, value } = classifySearch(term);
      const params: unknown[] = [eventId];
      let predicate: string;
      if (kind === 'DATE_OF_BIRTH') {
        params.push(value);
        predicate = 'pl.date_of_birth = $2::date'; // players only: only they have a birth date
      } else if (kind === 'REGISTRATION_NUMBER') {
        params.push(value);
        predicate = 'r.registration_number = $2';
      } else {
        params.push(value);
        // School ID: exact. Names: every word must start the first or the last name (no fuzzy matching).
        const tokens = value
          .split(/[\s,]+/)
          .filter(Boolean)
          .slice(0, 3);
        const nameParts = tokens.map((t) => {
          params.push(t);
          const n = params.length;
          return `(starts_with(lower(coalesce(pl.first_name, sp.first_name)), lower($${n})) or starts_with(lower(coalesce(pl.last_name, sp.last_name)), lower($${n})))`;
        });
        predicate = `(lower(pl.school_id) = lower($2)${nameParts.length ? ` or (${nameParts.join(' and ')})` : ''})`;
      }
      params.push(SEARCH_LIMIT + 1);
      const { rows } = await q.query<{
        registration_id: string;
        registration_number: string;
        registrant_type: 'PLAYER' | 'COACH' | 'STAFF';
        first_name: string;
        last_name: string;
        team_name: string | null;
        ready: boolean;
        checked_in: boolean;
      }>(
        `select r.id as registration_id, r.registration_number, r.registrant_type,
                coalesce(pl.first_name, sp.first_name) as first_name,
                coalesce(pl.last_name, sp.last_name) as last_name, t.name as team_name,
                (r.status = 'READY_FOR_EVENT' and not r.event_access_disabled) as ready,
                exists (select 1 from public.check_ins c where c.registration_id = r.id) as checked_in
           from public.registrations r
           left join public.players pl on pl.id = r.player_id
           left join public.staff_profiles sp on sp.id = r.staff_profile_id
           left join public.teams t on t.id = r.team_id
          where r.event_id = $1
            and r.status not in ('DRAFT', 'CANCELLED')
            and ${predicate}
          order by lower(coalesce(pl.last_name, sp.last_name)), lower(coalesce(pl.first_name, sp.first_name)),
                   r.registration_number
          limit $${params.length}`,
        params,
      );
      return {
        truncated: rows.length > SEARCH_LIMIT,
        results: rows.slice(0, SEARCH_LIMIT).map((r) => ({
          registrationId: r.registration_id,
          registrationNumber: r.registration_number,
          registrantType: r.registrant_type,
          firstName: r.first_name,
          lastName: r.last_name,
          teamName: r.team_name,
          ready: r.ready,
          checkedIn: r.checked_in,
        })),
      };
    },

    audit(entry: {
      action: AuditAction;
      actorUserId: string;
      entityType: string;
      entityId: string;
      metadata: Record<string, string | number | boolean | null>;
      meta: RequestMeta;
    }): Promise<void> {
      return recordAudit(q, entry);
    },
  };
}

async function findCheckIn(
  q: Queryable,
  column: string,
  value: string,
): Promise<CheckInRow | null> {
  // `column` is one of the constants chosen above, never input.
  const { rows } = await q.query<{
    id: string;
    event_id: string;
    registration_id: string;
    registration_number: string;
    method: 'FACE' | 'MANUAL';
    checked_in_at: Date;
    checked_in_by: string;
    face_scan_id: string | null;
  }>(
    `select c.id, c.event_id, c.registration_id, r.registration_number, c.method, c.checked_in_at,
            c.checked_in_by, c.face_scan_id
       from public.check_ins c join public.registrations r on r.id = c.registration_id
      where ${column} = $1`,
    [value],
  );
  const r = rows[0];
  return r
    ? {
        checkInId: r.id,
        eventId: r.event_id,
        registrationId: r.registration_id,
        registrationNumber: r.registration_number,
        method: r.method,
        checkedInAt: r.checked_in_at.toISOString(),
        checkedInBy: r.checked_in_by,
        faceScanId: r.face_scan_id,
      }
    : null;
}

export type EventDayRepo = ReturnType<typeof bind>;

export interface EventDayRepository extends EventDayRepo {
  /** Runs `fn` with a repository bound to one database transaction. */
  transaction<T>(fn: (repo: EventDayRepo) => Promise<T>): Promise<T>;
}

export function createEventDayRepository(db: Database): EventDayRepository {
  return { ...bind(db), transaction: (fn) => db.transaction((tx) => fn(bind(tx))) };
}
