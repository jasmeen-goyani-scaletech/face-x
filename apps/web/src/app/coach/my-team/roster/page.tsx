import { redirect } from 'next/navigation';

/** The coach's roster lives in the admin-style shell now (side navigation, team picker): `/admin/roster`. */
export default function CoachTeamRosterPage() {
  redirect('/admin/roster');
}
