'use client';

import { useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { ShieldIcon } from '@/components/ui/Icons';
import { accessCompliance, accessState, blockedSummary } from '@/lib/accessCompliance';
import { useEventRoster } from '@/lib/roster';
import { playersOfTeam } from '@/lib/teamRoster';
import type { RosterEntry } from '@/lib/seed';
import { useLocalStorage } from '@/lib/storage';
import { freshCoachRegistration, type CoachRegistration } from '@/lib/types';

export type CoachTeamState =
  | { kind: 'loading' }
  | { kind: 'gate'; title: string; message: ReactNode; action?: { href: string; label: string } }
  | {
      kind: 'ready';
      team: { teamId: string; teamName: string };
      /**
       * The ONLY people a coach screen is handed: roster entries whose role is "player" and whose team id is exactly the
       * coach's. Staff, other coaches and players on other teams are removed here, so no view can show them by accident.
       */
      players: RosterEntry[];
    };

/**
 * Who this device's coach is and which team's players they may see. Used by every coach team screen.
 *
 * A coach only gets in once their own event-day access is Enabled (approved, documents and flags clear, not switched off;
 * the same rule as the admin pages) and they are assigned to a team. Anyone else gets a `gate` explaining why.
 * Players are matched on the team's id, not its name, so two teams that share a name can never see each other's players.
 * There is no coach login in the app; this reads the coach registration saved on this device.
 */
export function useCoachTeam(): CoachTeamState {
  const { roster } = useEventRoster();
  const [reg, , hydrated] = useLocalStorage<CoachRegistration>('facex-coach-registration', freshCoachRegistration());

  const self = roster.find((r) => r.id === 'self-coach');
  const team = reg.invite ?? reg.team;
  const teamId = team?.teamId ?? '';

  const players = useMemo(() => playersOfTeam(roster, teamId), [roster, teamId]);

  if (!hydrated) return { kind: 'loading' };

  if (reg.status !== 'submitted' || !self) {
    return {
      kind: 'gate',
      title: 'No coach registration yet',
      message: 'Register and get approved to see your team here.',
      action: { href: '/register/coach', label: 'Register as a coach' }
    };
  }

  const compliance = accessCompliance({
    registration: reg.adminStatus,
    flags: self.flags,
    documents: [
      { file: reg.livePhoto ?? { uploaded: false, fileName: '', review: 'not_submitted' }, required: true },
      { file: reg.certificates.firstAidCpr, required: true },
      { file: reg.certificates.yalfTackle, required: true },
      { file: reg.certificates.backgroundCheckRef, required: true }
    ]
  });
  const access = accessState(compliance, self.disabled);

  if (access === 'blocked') {
    return {
      kind: 'gate',
      title: 'Access isn’t active yet',
      message: `${blockedSummary(compliance)} Your team opens once an organizer has approved everything.`,
      action: { href: '/register/coach', label: 'View my registration status' }
    };
  }
  if (access === 'disabled') {
    return { kind: 'gate', title: 'Access is turned off', message: 'An organizer has switched off your access. Contact them to have it restored.' };
  }
  if (!team) {
    return { kind: 'gate', title: 'No team assigned', message: 'You’re approved, but you haven’t been linked to a team yet. Register through your team’s link, or ask an organizer.' };
  }

  return { kind: 'ready', team: { teamId: team.teamId, teamName: team.teamName }, players };
}

/** The "you can't see this yet" card for a `gate` state. */
export function CoachGateCard({ gate }: { gate: Extract<CoachTeamState, { kind: 'gate' }> }) {
  return (
    <Card className="mx-auto max-w-xl text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-warning-soft text-warning">
        <ShieldIcon size={26} />
      </div>
      <h1 className="mb-2 text-xl">{gate.title}</h1>
      <div className="mb-5 text-sm text-ink-soft">{gate.message}</div>
      {gate.action && (
        <Link href={gate.action.href} className="no-underline">
          <Button variant="primary">{gate.action.label}</Button>
        </Link>
      )}
    </Card>
  );
}
