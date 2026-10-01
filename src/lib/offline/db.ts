import Dexie, { type Table } from 'dexie';
import type { RosterEntry } from '../seed';

/** A cached roster row. `fullName` is denormalised so it can be indexed; everything else is the roster entry as-is. */
export type RosterRecord = RosterEntry & { fullName: string };

export type PendingStatus = 'PENDING' | 'SYNCING' | 'FAILED';

/** A check-in made on this device that the Admin API hasn't acknowledged yet. */
export interface PendingCheckIn {
  /** Idempotency key: the server ignores a uuid it has already recorded, so a retry can never double check-in. */
  uuid: string;
  /** This browser's roster row id. Random per browser, so it only identifies the person locally. */
  personId: string;
  /** The stable registration ID (e.g. SID-48214): what the server and other devices identify the person by. Absent on items queued by older builds. */
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
}

export class FaceXOfflineDB extends Dexie {
  players!: Table<RosterRecord, string>;
  staff!: Table<RosterRecord, string>;
  coaches!: Table<RosterRecord, string>;
  pendingCheckIns!: Table<PendingCheckIn, string>;

  constructor() {
    super('facex-offline');
    this.version(1).stores({
      players: 'id, fullName, email, teamId, role',
      staff: 'id, fullName, email, teamId, role',
      coaches: 'id, fullName, email, teamId, role',
      pendingCheckIns: 'uuid, status, createdAt, personId'
    });
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
