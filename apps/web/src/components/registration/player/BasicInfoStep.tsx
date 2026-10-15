'use client';

import Card from '@/components/ui/Card';
import StepActions from '@/components/ui/StepActions';
import Alert from '@/components/ui/Alert';
import { SelectField, TextField } from '@/components/ui/Field';
import LockedTeamDropdown from '@/components/registration/LockedTeamDropdown';
import { dobBounds, dobError } from '@/lib/age';
import PlayerAgeCalculatorField from './PlayerAgeCalculatorField';
import SaveErrorAlert from './SaveErrorAlert';
import type { ApiEvent, ApiTeam } from '@/lib/api/types';
import type { InviteState } from '@/lib/registration/usePlayerWizard';
import { MSG, compact, validatePersonBasics } from '@/lib/validation';
import { useFieldErrors } from '@/lib/useFieldErrors';
import { formatEventDate } from '@/lib/format';
import type { PlayerRegistration } from '@/lib/types';

type BasicField = 'event' | 'firstName' | 'lastName' | 'dob' | 'phone' | 'email' | 'team';

// Same order as on screen: submit focuses the first invalid one. Keys equal the input ids.
const FIELD_ORDER: BasicField[] = ['event', 'firstName', 'lastName', 'dob', 'phone', 'email', 'team'];

const eventDate = (e: ApiEvent) => formatEventDate(e.startsAt, e.timezone);

export default function BasicInfoStep({
  reg,
  onChange,
  onNext,
  isMinor,
  events,
  eventId,
  onEventChange,
  teams,
  invite,
  hasRegistration,
  locked,
  saving,
  saveError,
  apiFieldErrors
}: {
  reg: PlayerRegistration;
  onChange: (next: PlayerRegistration) => void;
  onNext: () => void;
  isMinor: boolean;
  events: ApiEvent[];
  eventId: string;
  onEventChange: (id: string) => void;
  teams: ApiTeam[];
  invite: InviteState;
  /** A draft already exists on the server: the event can no longer be changed. */
  hasRegistration: boolean;
  /** Submitted: the details are read-only. */
  locked: boolean;
  saving: boolean;
  saveError: string | null;
  apiFieldErrors: Record<string, string>;
}) {
  const b = reg.basic;
  const dobIssue = b.dob ? dobError(b.dob) : null;
  const { min: dobMin, max: dobMax } = dobBounds();
  const selected = events.find((e) => e.id === eventId) ?? null;
  // The invite names the event, so there is nothing to choose.
  const chooseEvent = !hasRegistration && invite.status !== 'valid' && events.length > 1;
  const noEvents = events.length === 0 && !hasRegistration;

  const { error, blur, submit } = useFieldErrors<BasicField>(
    {
      ...validatePersonBasics(b),
      ...compact({
        event: eventId ? null : 'Please select the event you’re registering for.',
        dob: b.dob ? dobError(b.dob) : MSG.dobRequired,
        team: reg.teamId ? null : MSG.team
      })
    },
    FIELD_ORDER
  );

  function set<K extends keyof PlayerRegistration['basic']>(key: K, value: PlayerRegistration['basic'][K]) {
    onChange({ ...reg, basic: { ...reg.basic, [key]: value } });
  }

  function validateAndNext() {
    if (locked) return onNext();
    if (submit()) onNext();
  }

  return (
    <Card>
      <h2 className="text-xl mb-1">Player Information</h2>
      <p className="text-ink-soft mb-5">Tell us about the athlete registering to play.</p>

      {locked && (
        <Alert level="info" title="Registration submitted">
          This registration has been submitted, so these details can’t be changed here.
        </Alert>
      )}
      {noEvents && (
        <Alert level="warning" title="No events are open for registration">
          There isn’t an event taking registrations right now. Please check back soon.
        </Alert>
      )}
      {invite.status === 'valid' && (
        <Alert level="success" title={`Joining ${invite.invite.teamName} via Coach Invite`}>
          {invite.invite.club} — team is locked to this invite.
        </Alert>
      )}
      {invite.status === 'invalid' && (
        <Alert level="warning" title="Invite link not valid">
          This invite link isn’t valid any more. You can still register and select your team manually.
        </Alert>
      )}
      <SaveErrorAlert error={saveError} fieldErrors={apiFieldErrors} />

      <fieldset disabled={locked || saving} className="m-0 min-w-0 border-0 p-0">
        {chooseEvent ? (
          <SelectField
            id="event"
            label="Event"
            value={eventId}
            error={error('event')}
            onBlur={blur('event')}
            onChange={(e) => onEventChange(e.target.value)}
          >
            <option value="">Select an event...</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} — {eventDate(e)}
              </option>
            ))}
          </SelectField>
        ) : (
          selected && (
            <p className="text-[12.5px] text-ink-faint mb-4">
              <strong className="text-ink-soft">{selected.name}</strong> · {eventDate(selected)} · {selected.location}
            </p>
          )
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
          <TextField
            id="firstName"
            label="First Name"
            autoComplete="given-name"
            value={b.firstName}
            error={error('firstName')}
            onBlur={blur('firstName')}
            onChange={(e) => set('firstName', e.target.value)}
          />
          <TextField
            id="lastName"
            label="Last Name"
            autoComplete="family-name"
            value={b.lastName}
            error={error('lastName')}
            onBlur={blur('lastName')}
            onChange={(e) => set('lastName', e.target.value)}
          />
          <TextField
            id="dob"
            label="Date of Birth"
            type="date"
            min={dobMin}
            max={dobMax}
            value={b.dob}
            error={error('dob')}
            onBlur={blur('dob')}
            onChange={(e) => set('dob', e.target.value)}
          />
          <TextField
            id="phone"
            label="Mobile Number"
            type="tel"
            autoComplete="tel"
            placeholder="555-019-2831"
            value={b.phone}
            error={error('phone')}
            onBlur={blur('phone')}
            onChange={(e) => set('phone', e.target.value)}
          />
        </div>
        <TextField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="name@example.com"
          value={b.email}
          error={error('email')}
          onBlur={blur('email')}
          onChange={(e) => set('email', e.target.value)}
        />

        <PlayerAgeCalculatorField dob={b.dob} />

        {isMinor === false && b.dob && !dobIssue && (
          <p className="text-[12.5px] text-ink-faint -mt-2 mb-4">
            Player is 18 or older — guardian details and the consent waiver won&rsquo;t be required.
          </p>
        )}

        <LockedTeamDropdown
          value={reg.teamId}
          error={error('team')}
          lockedTeam={reg.invite}
          teams={teams.map((t) => ({ teamId: t.id, teamName: t.name, club: t.club }))}
          onBlur={blur('team')}
          onChange={(teamId) => onChange({ ...reg, teamId })}
        />
      </fieldset>

      <StepActions onNext={validateAndNext} nextLoading={saving} nextDisabled={noEvents} />
    </Card>
  );
}
