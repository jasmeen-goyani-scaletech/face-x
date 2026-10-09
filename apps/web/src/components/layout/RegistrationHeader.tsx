import Topbar from './Topbar';
import type { RegistrationRole } from '@/lib/activeRole';

export type RegistrationHeaderRole = 'PLAYER' | 'COACH' | 'STAFF';

const ROLE_KEY: Record<RegistrationHeaderRole, RegistrationRole> = { PLAYER: 'player', COACH: 'coach', STAFF: 'staff' };
const ROLE_NAME: Record<RegistrationHeaderRole, string> = { PLAYER: 'Player', COACH: 'Coach', STAFF: 'Staff' };

/**
 * The one header for every /register/{player|coach|staff} view: FX logo + "FACE-X" + "<Role> registration" on the left,
 * the colour-coded role badge on the right. Wizard state (draft, submitted…) never changes it, so it can't drift per page.
 */
export default function RegistrationHeader({ role }: { role: RegistrationHeaderRole }) {
  return <Topbar role={ROLE_KEY[role]} eyebrow={`${ROLE_NAME[role]} registration`} />;
}
