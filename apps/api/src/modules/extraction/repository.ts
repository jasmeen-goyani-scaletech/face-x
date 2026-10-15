import type { Queryable } from '../../infrastructure/database/database';
import type { DocumentType } from '../documents/types';
import { ownsRegistrantSql } from '../staff';

/** One document with what is needed to authorize the caller and to compare it with the profile. Read-only. */
export interface ExtractionTarget {
  documentId: string;
  documentType: DocumentType;
  /** Internal; never returned. */
  storageKey: string;
  mimeType: string;
  uploaded: boolean;
  submitted: boolean;
  isOwner: boolean;
  eventOrganizationId: string;
  profile: {
    firstName: string;
    lastName: string;
    /** YYYY-MM-DD, players only. */
    dateOfBirth: string | null;
    /** The event's start date in its own time zone, YYYY-MM-DD. */
    eventDate: string;
  };
}

export interface ExtractionRepository {
  findTarget(documentId: string, userId: string): Promise<ExtractionTarget | null>;
  /** Remembers whether the AI accepted this file. Only an unreviewed document is touched. */
  setAiAccepted(documentId: string, accepted: boolean): Promise<void>;
}

interface Row {
  id: string;
  document_type: DocumentType;
  storage_key: string;
  mime_type: string;
  uploaded: boolean;
  submitted: boolean;
  is_owner: boolean;
  org: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  event_date: string;
}

export function createExtractionRepository(db: Queryable): ExtractionRepository {
  return {
    async setAiAccepted(documentId, accepted) {
      await db.query(
        "update public.documents set ai_accepted = $2 where id = $1 and status = 'PENDING'",
        [documentId, accepted],
      );
    },

    async findTarget(documentId, userId) {
      // The registration is either a player's or a coach's/staff member's: whichever profile it points at is the record.
      const { rows } = await db.query<Row>(
        `select d.id, d.document_type, d.storage_key, d.mime_type,
                d.uploaded_at is not null as uploaded, d.submitted_at is not null as submitted,
                ${ownsRegistrantSql('pl', 'sp', '$2')} as is_owner, e.organization_id as org,
                coalesce(pl.first_name, sp.first_name) as first_name,
                coalesce(pl.last_name, sp.last_name) as last_name,
                to_char(pl.date_of_birth, 'YYYY-MM-DD') as date_of_birth,
                to_char((e.starts_at at time zone e.timezone)::date, 'YYYY-MM-DD') as event_date
           from public.documents d
           join public.registrations r on r.id = d.registration_id
           left join public.players pl on pl.id = r.player_id
           left join public.staff_profiles sp on sp.id = r.staff_profile_id
           join public.events e on e.id = r.event_id
          where d.id = $1`,
        [documentId, userId],
      );
      const r = rows[0];
      return r
        ? {
            documentId: r.id,
            documentType: r.document_type,
            storageKey: r.storage_key,
            mimeType: r.mime_type,
            uploaded: r.uploaded,
            submitted: r.submitted,
            isOwner: r.is_owner,
            eventOrganizationId: r.org,
            profile: {
              firstName: r.first_name,
              lastName: r.last_name,
              dateOfBirth: r.date_of_birth,
              eventDate: r.event_date,
            },
          }
        : null;
    },
  };
}
