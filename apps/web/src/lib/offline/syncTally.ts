/**
 * Counting and wording for an offline-sync pass, kept free of IndexedDB and React so it can be tested on its own.
 *
 * The queue can hold several items for one person (e.g. a double tap before this was prevented), and the server answers an
 * extra one "already checked in". The admin cares about PEOPLE, so everything here counts unique people, not queue items.
 */

export type ItemOutcome = { personId: string; kind: 'recorded' | 'already' | 'failed' };

export interface SyncTally {
  /** People whose check-in this device just got recorded by the server. */
  synced: number;
  /** People the server already had checked in (another device, or an earlier attempt) and that this device did not record itself. */
  alreadyRecorded: number;
  /** People whose check-in the server refused for good. */
  failed: number;
}

export function tallyOutcomes(outcomes: ItemOutcome[]): SyncTally {
  const recorded = new Set<string>();
  const already = new Set<string>();
  const failed = new Set<string>();
  for (const o of outcomes) (o.kind === 'recorded' ? recorded : o.kind === 'already' ? already : failed).add(o.personId);
  for (const id of recorded) {
    already.delete(id);
    failed.delete(id);
  }
  for (const id of already) failed.delete(id);
  return { synced: recorded.size, alreadyRecorded: already.size, failed: failed.size };
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export interface SyncNotice {
  text: string;
  tone: 'success' | 'danger';
}

/** The messages to show after a pass. Nothing is said about a pass that did nothing. */
export function syncNotices(t: SyncTally & { interrupted: boolean }): SyncNotice[] {
  const out: SyncNotice[] = [];
  if (t.synced > 0) out.push({ text: `${t.synced} offline check-in${plural(t.synced, '', 's')} successfully synced to Admin`, tone: 'success' });
  if (t.alreadyRecorded > 0)
    out.push({
      text: `${t.alreadyRecorded} ${plural(t.alreadyRecorded, 'person was', 'people were')} already checked in (on another device or earlier), so nothing new was added`,
      tone: 'success'
    });
  if (t.failed > 0) out.push({ text: `${t.failed} check-in${plural(t.failed, ' was', 's were')} rejected by Admin and need review`, tone: 'danger' });
  if (t.interrupted) out.push({ text: 'Couldn’t reach Admin. Check-ins are saved and will retry.', tone: 'danger' });
  return out;
}
