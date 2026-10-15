'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import SaveErrorAlert from '@/components/registration/player/SaveErrorAlert';
import { updateAdminTeam } from '@/lib/api/admin';
import { describeError, fieldErrorsOf } from '@/lib/api/errors';
import type { ApiAdminTeam, ApiTeamLimit } from '@/lib/api/types';

const KINDS = [
  { key: 'players', field: 'maxPlayers', label: 'Players' },
  { key: 'coaches', field: 'maxCoaches', label: 'Coaches' },
  { key: 'staff', field: 'maxStaff', label: 'Staff' }
] as const;

type Draft = Record<(typeof KINDS)[number]['key'], string>;

const toDraft = (limits: ApiAdminTeam['limits']): Draft => ({
  players: limits.players.max?.toString() ?? '',
  coaches: limits.coaches.max?.toString() ?? '',
  staff: limits.staff.max?.toString() ?? ''
});

/** Empty = unlimited (null). Otherwise a positive whole number, or NaN for anything else. */
const parseLimit = (raw: string): number | null => {
  const t = raw.trim();
  if (t === '') return null;
  return /^\d+$/.test(t) && Number(t) >= 1 ? Number(t) : Number.NaN;
};

function usage(limit: ApiTeamLimit) {
  if (limit.max === null) return `${limit.used} registered · Unlimited`;
  const full = limit.used >= limit.max;
  return `${limit.used} of ${limit.max} registered${full ? ' · Full' : ''}`;
}

/**
 * Registration limits for one team, per kind of registrant. Empty means unlimited (the default). Lowering a limit below the
 * current count keeps everyone already registered; it only stops new registrations until the count falls below it.
 */
export default function TeamLimitsCard({ team, onSaved }: { team: ApiAdminTeam; onSaved: (team: ApiAdminTeam) => void }) {
  const { notify } = useToast();
  const [draft, setDraft] = useState<Draft>(() => toDraft(team.limits));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const parsed = KINDS.map((k) => ({ ...k, value: parseLimit(draft[k.key]) }));
  const invalid = parsed.some((p) => Number.isNaN(p.value));
  const changed = parsed.some((p) => p.value !== team.limits[p.key].max);
  const lowered = parsed.filter((p) => p.value !== null && !Number.isNaN(p.value) && p.value < team.limits[p.key].used);

  async function save() {
    if (saving || invalid || !changed) return;
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      const body = Object.fromEntries(parsed.filter((p) => p.value !== team.limits[p.key].max).map((p) => [p.field, p.value]));
      const saved = await updateAdminTeam(team.id, body);
      onSaved(saved);
      setDraft(toDraft(saved.limits));
      notify('Registration limits saved.');
    } catch (e) {
      setError(describeError(e, 'We couldn’t save the limits. Please try again.'));
      setFieldErrors(fieldErrorsOf(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mt-5">
      <h2 className="text-lg mb-1">Registration Limits</h2>
      <p className="text-ink-soft text-sm mb-4">
        The most registrations this team accepts for each type. Leave a box empty for no limit. Registrations that are already in are never removed.
      </p>
      <SaveErrorAlert error={error} fieldErrors={fieldErrors} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {parsed.map((p) => {
          const bad = Number.isNaN(p.value);
          return (
            <div key={p.key}>
              <label htmlFor={`limit-${p.key}`} className="block text-[13px] font-semibold text-ink mb-1">
                {p.label}
              </label>
              <input
                id={`limit-${p.key}`}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                placeholder="Unlimited"
                value={draft[p.key]}
                onChange={(e) => setDraft({ ...draft, [p.key]: e.target.value })}
                aria-invalid={bad}
                aria-describedby={`limit-${p.key}-use`}
                className="w-full rounded-s border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
              />
              <p id={`limit-${p.key}-use`} className={['mt-1 text-[12.5px]', bad ? 'text-danger' : 'text-ink-soft'].join(' ')}>
                {bad ? 'Enter a whole number of 1 or more, or leave empty for no limit.' : usage(team.limits[p.key])}
              </p>
            </div>
          );
        })}
      </div>
      {lowered.length > 0 && (
        <p className="text-warning text-sm mt-3">
          {lowered.map((p) => p.label.toLowerCase()).join(' and ')} already above the new limit: existing registrations stay, new ones are blocked until the count is below it.
        </p>
      )}
      <div className="flex justify-end mt-4">
        <Button variant="primary" onClick={() => void save()} loading={saving} disabled={invalid || !changed}>
          Save Limits
        </Button>
      </div>
    </Card>
  );
}
