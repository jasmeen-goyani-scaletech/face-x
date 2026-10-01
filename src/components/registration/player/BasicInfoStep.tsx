'use client';

import Card from '@/components/ui/Card';
import StepActions from '@/components/ui/StepActions';
import Alert from '@/components/ui/Alert';
import { TextField, SelectField } from '@/components/ui/Field';
import { dobBounds, dobError } from '@/lib/age';
import PlayerAgeCalculatorField from './PlayerAgeCalculatorField';
import { getTeamDirectory } from '@/lib/teams';
import { MSG, compact, validatePersonBasics } from '@/lib/validation';
import { useFieldErrors } from '@/lib/useFieldErrors';
import type { PlayerRegistration } from '@/lib/types';

type BasicField = 'firstName' | 'lastName' | 'dob' | 'phone' | 'email' | 'team';

// Same order as on screen: submit focuses the first invalid one. Keys equal the input ids.
const FIELD_ORDER: BasicField[] = ['firstName', 'lastName', 'dob', 'phone', 'email', 'team'];

export default function BasicInfoStep({
  reg,
  onChange,
  onNext,
  isMinor
}: {
  reg: PlayerRegistration;
  onChange: (next: PlayerRegistration) => void;
  onNext: () => void;
  isMinor: boolean;
}) {
  const b = reg.basic;
  const dobIssue = b.dob ? dobError(b.dob) : null;
  const { min: dobMin, max: dobMax } = dobBounds();
  const locked = !!reg.invite;

  const { error, blur, submit } = useFieldErrors<BasicField>(
    {
      ...validatePersonBasics(b),
      ...compact({ dob: b.dob ? dobError(b.dob) : MSG.dobRequired, team: reg.teamId ? null : MSG.team })
    },
    FIELD_ORDER
  );

  function set<K extends keyof PlayerRegistration['basic']>(key: K, value: PlayerRegistration['basic'][K]) {
    onChange({ ...reg, basic: { ...reg.basic, [key]: value } });
  }

  function validateAndNext() {
    if (submit()) onNext();
  }

  return (
    <Card>
      <h2 className="text-xl mb-1">Player Information</h2>
      <p className="text-ink-soft mb-5">Tell us about the athlete registering to play.</p>

      {reg.invite && (
        <Alert level="success" title={`Joining ${reg.invite.teamName} via Coach Invite`}>
          {reg.invite.club} — team is locked to this invite.
        </Alert>
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

      <SelectField
        id="team"
        label="Team & Club"
        value={reg.teamId}
        error={error('team')}
        disabled={locked}
        onBlur={blur('team')}
        onChange={(e) => onChange({ ...reg, teamId: e.target.value })}
      >
        <option value="">Select a team...</option>
        {getTeamDirectory().map((t) => (
          <option key={t.teamId} value={t.teamId}>
            {t.teamName} — {t.club}
          </option>
        ))}
      </SelectField>

      <StepActions onNext={validateAndNext} />
    </Card>
  );
}
