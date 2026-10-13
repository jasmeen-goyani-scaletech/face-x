import Dexie, { type Table } from 'dexie';
import type { RosterEntry } from '../seed';

/** A cached roster row. `fullName` is denormalised so it can be indexed; everything else is the roster entry as-is. */
export type RosterRecord = RosterEntry & { fullName: string };

export type PendingStatus = 'PENDING' | 'SYNCING' | 'FAILED';

/** A check-in made on this device that the Admin API hasn't acknowledged yet. */
export interface PendingCheckIn {
  /** Idempotency key: the server ignores a uuid it has already recorded, so a retry can never double check-in. */
  uuid: string;
  /** The registration being checked in (a roster row's id is its registration id). */
  personId: string;
  /** The event the check-in is for. Absent on items queued by older builds, which can no longer be sent. */
  eventId?: string;
  /** The registration number shown to people (e.g. FX-2026-00042), kept for messages. */
  schoolId?: string;
  role: RosterEntry['role'];
  method: string;
  override: boolean;
  /** When the check-in actually happened on the device (ms epoch), not when it syncs. */
  checkedInAt: number;
  status: PendingStatus;
  attempts: number;
  createdAt: number;
  lastError?: string;
  /** The server's own words for why it refused (shown to the admin), when it did. */
  lastMessage?: string;
  /** The admin account that made this check-in. The server records who checked someone in, so only this account may send it. */
  ownerId?: string;
  /** Who it is, for messages ("Jane Doe"), so a refusal can say whom it was about. */
  label?: string;
}

export class FaceXOfflineDB extends Dexie {
  players!: Table<RosterRecord, string>;
  staff!: Table<RosterRecord, string>;
  coaches!: Table<RosterRecord, string>;
  pendingCheckIns!: Table<PendingCheckIn, string>;
  /** Small facts about the device's copy (which roster it holds, and when it was read). */
  meta!: Table<{ key: string; value: unknown }, string>;

  constructor() {
    super('facex-offline');
    this.version(1).stores({
      players: 'id, fullName, email, teamId, role',
      staff: 'id, fullName, email, teamId, role',
      coaches: 'id, fullName, email, teamId, role',
      pendingCheckIns: 'uuid, status, createdAt, personId'
    });
    // Adds the table that says which roster the device holds. The queue is untouched: nothing waiting to sync is ever lost to an upgrade.
    this.version(2).stores({ meta: 'key' });
  }
}

let instance: FaceXOfflineDB | null = null;

/** The shared database, or null where IndexedDB doesn't exist (SSR, some private modes). Callers must tolerate null. */
export function getOfflineDb(): FaceXOfflineDB | null {
  if (typeof indexedDB === 'undefined') return null;
  if (!instance) instance = new FaceXOfflineDB();
  return instance;
}

export function tableForRole(db: FaceXOfflineDB, role: RosterEntry['role']): Table<RosterRecord, string> {
  return role === 'player' ? db.players : role === 'coach' ? db.coaches : db.staff;
}

export function newUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}
