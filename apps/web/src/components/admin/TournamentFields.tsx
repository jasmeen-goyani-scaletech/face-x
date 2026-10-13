'use client';

import { SelectField, TextField } from '@/components/ui/Field';
import type { ApiAdminEvent, CreateEventInput } from '@/lib/api/types';
import { centsToDollars, dollarsToCents, DEFAULT_EVENT_TIME_ZONE, EVENT_TIME_ZONES, isoToZoned, zonedToIso } from '@/lib/admin/eventTime';

/** What the tournament form edits: the event as an admin thinks of it (a date, clock times, a fee in dollars). */
export interface TournamentForm {
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  timezone: string;
  location: string;
  fee: string;
  description: string;
}

export const emptyTournamentForm = (): TournamentForm => ({
  name: '',
  date: '',
  startTime: '17:30',
  endTime: '20:00',
  timezone: DEFAULT_EVENT_TIME_ZONE,
  location: '',
  fee: '',
  description: ''
});

export function formFromEvent(e: ApiAdminEvent): TournamentForm {
  const start = isoToZoned(e.startsAt, e.timezone);
  const end = isoToZoned(e.endsAt, e.timezone);
  return {
    name: e.name,
    date: start.date,
    startTime: start.time,
    endTime: end.time,
    timezone: e.timezone,
    location: e.location,
    fee: centsToDollars(e.fee.amountCents),
    description: e.description ?? ''
  };
}

/** What is wrong with the form, keyed by the id of the field to focus. Empty when it can be sent. */
export function tournamentErrors(f: TournamentForm): Partial<Record<'name' | 'date' | 'startTime' | 'endTime' | 'location' | 'fee', string>> {
  const out: Partial<Record<'name' | 'date' | 'startTime' | 'endTime' | 'location' | 'fee', string>> = {};
  if (!f.name.trim()) out.name = 'Please enter a tournament name.';
  if (!f.date) out.date = 'Please choose the tournament date.';
  if (!f.startTime) out.startTime = 'Please enter when it starts.';
  if (!f.endTime) out.endTime = 'Please enter when it ends.';
  else if (f.startTime && f.endTime < f.startTime) out.endTime = 'The end can’t be before the start.';
  if (!f.location.trim()) out.location = 'Please enter where it is held.';
  if (dollarsToCents(f.fee) === null) out.fee = 'Enter an amount like 95 or 95.50.';
  return out;
}

/** The API's wording of the form, for a form that passed `tournamentErrors`. */
export function inputFromForm(f: TournamentForm): CreateEventInput {
  return {
    name: f.name.trim(),
    description: f.description.trim() || null,
    location: f.location.trim(),
    timezone: f.timezone,
    startsAt: zonedToIso(f.date, f.startTime, f.timezone),
    endsAt: zonedToIso(f.date, f.endTime, f.timezone),
    feeCents: dollarsToCents(f.fee) ?? 0
  };
}

/** The API's field paths, mapped onto the form's field ids, so a server-side problem shows beside the right input. */
export const API_FIELD_TO_FORM: Record<string, keyof TournamentForm> = {
  name: 'name',
  startsAt: 'date',
  endsAt: 'endTime',
  timezone: 'timezone',
  location: 'location',
  feeCents: 'fee',
  description: 'description'
};

/** The form's inputs, shared by "New Tournament" and the tournament's own page. `idPrefix` keeps the ids of two forms apart. */
export default function TournamentFields({
  form,
  onChange,
  error,
  blur,
  idPrefix = ''
}: {
  form: TournamentForm;
  onChange: (next: TournamentForm) => void;
  error: (key: 'name' | 'date' | 'startTime' | 'endTime' | 'location' | 'fee') => string | undefined;
  blur: (key: 'name' | 'date' | 'startTime' | 'endTime' | 'location' | 'fee') => () => void;
  idPrefix?: string;
}) {
  const set = <K extends keyof TournamentForm>(key: K, value: TournamentForm[K]) => onChange({ ...form, [key]: value });
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
      <TextField id="name" label="Tournament Name" value={form.name} error={error('name')} onBlur={blur('name')} onChange={(e) => set('name', e.target.value)} />
      <TextField id="date" label="Date" type="date" value={form.date} error={error('date')} onBlur={blur('date')} onChange={(e) => set('date', e.target.value)} />
      <TextField id="startTime" label="Starts" type="time" value={form.startTime} error={error('startTime')} onBlur={blur('startTime')} onChange={(e) => set('startTime', e.target.value)} />
      <TextField id="endTime" label="Ends" type="time" value={form.endTime} error={error('endTime')} onBlur={blur('endTime')} onChange={(e) => set('endTime', e.target.value)} />
      <SelectField id={`${idPrefix}timezone`} label="Time zone" value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>
        {EVENT_TIME_ZONES.map((z) => (
          <option key={z.value} value={z.value}>
            {z.label}
          </option>
        ))}
        {!EVENT_TIME_ZONES.some((z) => z.value === form.timezone) && <option value={form.timezone}>{form.timezone}</option>}
      </SelectField>
      <TextField
        id="fee"
        label="Player registration fee (USD)"
        optional
        inputMode="decimal"
        placeholder="0"
        hint="Coaches and staff never pay."
        value={form.fee}
        error={error('fee')}
        onBlur={blur('fee')}
        onChange={(e) => set('fee', e.target.value)}
      />
      <TextField id="location" label="Location" value={form.location} error={error('location')} onBlur={blur('location')} onChange={(e) => set('location', e.target.value)} />
      <TextField id={`${idPrefix}description`} label="Description" optional value={form.description} onChange={(e) => set('description', e.target.value)} />
    </div>
  );
}
