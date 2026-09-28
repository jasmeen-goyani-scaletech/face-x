'use client';

import { useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import { TextField, SelectField } from '@/components/ui/Field';
import { ChevronRightIcon } from '@/components/ui/Icons';
import { calcDivision } from '@/lib/age';
import { TEAM_DIRECTORY } from '@/lib/teams';
import type { PlayerRegistration } from '@/lib/types';

export default function BasicInfoStep({
  reg,
  onChange,
  onNext,
  isMinor,
  age
}: {
  reg: PlayerRegistration;
  onChange: (next: PlayerRegistration) => void;
  onNext: () => void;
  isMinor: boolean;
  age: number | null;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const division = calcDivision(reg.basic.dob);
  const locked = !!reg.invite;

  function set<K extends keyof PlayerRegistration['basic']>(key: K, value: PlayerRegistration['basic'][K]) {
    onChange({ ...reg, basic: { ...reg.basic, [key]: value } });
  }

  function validateAndNext() {
    const b = reg.basic;
    const e: Record<string, string> = {};
    if (!b.firstName.trim()) e.firstName = 'Required';
    if (!b.lastName.trim()) e.lastName = 'Required';
    if (!b.dob) e.dob = 'Required';
    if (!b.phone.trim() || b.phone.replace(/\D/g, '').length < 7) e.phone = 'Enter a valid phone number';
    if (!b.email.trim() || !b.email.includes('@')) e.email = 'Enter a valid email';
    setErrors(e);
    if (Object.keys(e).length === 0) onNext();
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
        <TextField id="firstName" label="First Name" value={reg.basic.firstName} error={errors.firstName} onChange={(e) => set('firstName', e.target.value)} />
        <TextField id="lastName" label="Last Name" value={reg.basic.lastName} error={errors.lastName} onChange={(e) => set('lastName', e.target.value)} />
        <TextField id="dob" label="Date of Birth" type="date" value={reg.basic.dob} error={errors.dob} onChange={(e) => set('dob', e.target.value)} />
        <TextField id="phone" label="Mobile Number" type="tel" placeholder="(555) 555-0100" value={reg.basic.phone} error={errors.phone} onChange={(e) => set('phone', e.target.value)} />
      </div>
      <TextField id="email" label="Email" type="email" value={reg.basic.email} error={errors.email} onChange={(e) => set('email', e.target.value)} />

      {reg.basic.dob && (
        <div className="rounded-m bg-accent-soft px-4 py-3 mb-4 flex items-center justify-between text-sm">
          <span className="text-accent-strong font-semibold">
            Age {age} · Division {division}
          </span>
          <span className="text-[11.5px] text-accent-strong opacity-80">Calculated automatically</span>
        </div>
      )}

      {isMinor === false && reg.basic.dob && (
        <p className="text-[12.5px] text-ink-faint -mt-2 mb-4">
          Player is 18 or older — the guardian/emergency contact step will be skipped.
        </p>
      )}

      <SelectField
        id="team"
        label="Team & Club"
        optional
        value={reg.teamId}
        disabled={locked}
        onChange={(e) => onChange({ ...reg, teamId: e.target.value })}
      >
        <option value="">Select a team (or assign later)</option>
        {TEAM_DIRECTORY.map((t) => (
          <option key={t.teamId} value={t.teamId}>
            {t.teamName} — {t.club}
          </option>
        ))}
      </SelectField>

      <div className="flex justify-end mt-2">
        <Button variant="primary" onClick={validateAndNext}>
          Continue <ChevronRightIcon size={16} />
        </Button>
      </div>
    </Card>
  );
}
