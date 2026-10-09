'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { ShieldIcon } from '@/components/ui/Icons';
import { createCoachTeam, getCoachTeam, getTeamRoster } from '@/lib/api/coachTeam';
import { describeError, hasCode } from '@/lib/api/errors';
import { listPersonnelRegistrations } from '@/lib/api/registrations';
import type { ApiCoachTeamView, ApiTeamMember, CreateCoachTeamInput } from '@/lib/api/types';
import type { RosterEntry } from '@/lib/seed';

/** A person on the coach's team, in the shape the roster cards use. */
export function memberToRosterEntry(m: ApiTeamMember, team: { id: string; name: string; division: string }): RosterEntry {
  const isPlayer = m.registrantType === 'PLAYER';
  return {
    id: m.registrationId,
    firstName: m.firstName,
    lastName: m.lastName,
    dob: m.dateOfBirth ?? '',
    schoolId: m.registrationNumber,
    role: isPlayer ? 'player' : 'staff',
    teamName: team.name,
    division: team.division,
    phone: m.phone ?? '',
    email: '',
    parentPhone: isPlayer ? (m.guardianPhone ?? '') : '',
    teamId: team.id,
    jerseyNumber: '',
    position: '',
    guardianName: isPlayer ? (m.guardianName ?? '') : '',
    photoUrl: '',
    approved: m.approved,
    paymentComplete: true,
    flags: m.flags,
    pendingReason: m.approved ? '' : m.flags.length > 0 ? m.flags.join(', ') : 'Registration is still being reviewed.',
    disabled: m.eventAccessDisabled,
    checkedInAt: m.checkedInAt ? Date.parse(m.checkedInAt) : null,
    checkedInMethod: m.checkedInAt ? 'Checked in' : null,
    checkedInOverride: false
  };
}

export type CoachTeamData =
  | { status: 'loading' }
  | { status: 'error'; message: string; retry: () => void }
  /** Signed in, but there is no coach registration for this account. */
  | { status: 'none' }
  | {
      status: 'loaded';
      view: ApiCoachTeamView;
      /** The team's players and staff; null while the roster is closed to this coach. */
      members: RosterEntry[] | null;
      refresh: () => Promise<void>;
      creating: boolean;
      createError: string | null;
      createTeam: (input: CreateCoachTeamInput) => Promise<boolean>;
    };

const ALIVE = (status: string) => status !== 'REJECTED' && status !== 'CANCELLED';

/**
 * The signed-in coach's team, read from the API: their coach registration, the team on it (if any), and the roster of
 * people registered to that team once the coach is cleared for the event. Also creates the team for an approved coach.
 */
export function useCoachTeamData(): CoachTeamData {
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'none' } | { kind: 'loaded'; view: ApiCoachTeamView; members: RosterEntry[] | null }>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const read = useCallback(async () => {
    // A signed-in account with no role yet answers 403 INSUFFICIENT_ROLE: it simply has no coach registration.
    const mine = await listPersonnelRegistrations('COACH').catch((e: unknown) => {
      if (hasCode(e, 'INSUFFICIENT_ROLE')) return [];
      throw e;
    });
    const current = mine.find((r) => ALIVE(r.status)) ?? mine[0];
    if (!current) return { kind: 'none' as const };
    const view = await getCoachTeam(current.id);
    let members: RosterEntry[] | null = null;
    if (view.team && view.rosterOpen) {
      const team = { id: view.team.id, name: view.team.name, division: view.team.division };
      members = (await getTeamRoster(current.id)).map((m) => memberToRosterEntry(m, team));
    }
    return { kind: 'loaded' as const, view, members };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    read()
      .then((s) => !cancelled && setState(s))
      .catch((e: unknown) => !cancelled && setState({ kind: 'error', message: describeError(e, 'We couldn’t load your team. Please try again.') }));
    return () => {
      cancelled = true;
    };
  }, [read, attempt]);

  const refresh = useCallback(async () => {
    setState(await read());
  }, [read]);

  const createTeam = useCallback(
    async (input: CreateCoachTeamInput) => {
      if (state.kind !== 'loaded' || creating) return false;
      setCreating(true);
      setCreateError(null);
      try {
        await createCoachTeam(state.view.registrationId, input);
        await refresh();
        return true;
      } catch (e) {
        setCreateError(describeError(e, 'We couldn’t create the team. Please try again.'));
        return false;
      } finally {
        setCreating(false);
      }
    },
    [state, creating, refresh]
  );

  if (state.kind === 'loaded') return { status: 'loaded', view: state.view, members: state.members, refresh, creating, createError, createTeam };
  if (state.kind === 'error') return { status: 'error', message: state.message, retry: () => setAttempt((n) => n + 1) };
  return { status: state.kind };
}

export type CoachTeamState =
  | { kind: 'loading' }
  | { kind: 'gate'; title: string; message: ReactNode; action?: { href: string; label: string }; retry?: () => void }
  | {
      kind: 'ready';
      team: { teamId: string; teamName: string };
      event: ApiCoachTeamView['event'];
      /**
       * The ONLY people a coach screen is handed: roster entries whose role is "player" and who are on the coach's own team.
       * The server already limits the roster to this team (players and staff); staff are removed here, so no view can show
       * them by accident.
       */
      players: RosterEntry[];
    };

/**
 * Who this coach is and which team's players they may see. Used by every coach team screen.
 *
 * A coach only gets in once they are cleared for the event (READY_FOR_EVENT, access not switched off) and are on a team.
 * Anyone else gets a `gate` explaining why. The server decides what the roster contains; this only shapes it for the screens.
 */
export function useCoachTeam(): CoachTeamState {
  const data = useCoachTeamData();
  if (data.status === 'loading') return { kind: 'loading' };
  if (data.status === 'error') return { kind: 'gate', title: 'We couldn’t load your team', message: data.message, retry: data.retry };
  if (data.status === 'none') {
    return {
      kind: 'gate',
      title: 'No coach registration yet',
      message: 'Register and get approved to see your team here.',
      action: { href: '/register/coach', label: 'Register as a coach' }
    };
  }

  const { view, members } = data;
  if (view.registrationStatus === 'REJECTED' || view.registrationStatus === 'CANCELLED') {
    return { kind: 'gate', title: 'Registration closed', message: 'This coach registration was not approved.', action: { href: '/register/coach', label: 'View my registration status' } };
  }
  if (view.eventAccessDisabled) {
    return { kind: 'gate', title: 'Access is turned off', message: 'An organizer has switched off your access. Contact them to have it restored.' };
  }
  if (!view.rosterOpen) {
    return {
      kind: 'gate',
      title: 'Access isn’t active yet',
      message: 'Your team opens once an organizer has approved everything.',
      action: { href: '/register/coach', label: 'View my registration status' }
    };
  }
  if (!view.team || !members) {
    return { kind: 'gate', title: 'No team assigned', message: 'You’re approved, but you haven’t been linked to a team yet. Register through your team’s link, or ask an organizer.' };
  }

  return {
    kind: 'ready',
    team: { teamId: view.team.id, teamName: view.team.name },
    event: view.event,
    players: members.filter((m) => m.role === 'player')
  };
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
      {gate.retry && (
        <Button variant="primary" onClick={gate.retry}>
          Try again
        </Button>
      )}
      {gate.action && (
        <Link href={gate.action.href} className="no-underline">
          <Button variant="primary">{gate.action.label}</Button>
        </Link>
      )}
    </Card>
  );
}
