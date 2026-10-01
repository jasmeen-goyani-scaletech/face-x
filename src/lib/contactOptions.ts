import { calcAge } from './age';
import type { RosterEntry } from './seed';

const digits = (value: string) => value.replace(/[^\d+]/g, '') || null;

export interface ContactOptions {
  minor: boolean;
  /** The player's own number, ready for tel: / sms:, or null if there is none. */
  playerPhone: string | null;
  /** The parent's number, or null if there is none. Always null for an adult, who has no parent to call. */
  parentPhone: string | null;
  /** Which call leads: the player if reachable, otherwise the parent, otherwise nobody. */
  primary: 'player' | 'parent' | null;
}

/** How a coach can reach one player, from the numbers on file. */
export function contactOptions(e: Pick<RosterEntry, 'dob' | 'phone' | 'parentPhone'>): ContactOptions {
  const minor = (calcAge(e.dob) ?? 99) < 18;
  const playerPhone = digits(e.phone);
  const parentPhone = minor ? digits(e.parentPhone) : null;
  const primary = playerPhone ? 'player' : parentPhone ? 'parent' : null;
  return { minor, playerPhone, parentPhone, primary };
}
