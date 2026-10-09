import Alert from '@/components/ui/Alert';
import { SelectField } from '@/components/ui/Field';
import type { ApiEvent } from '@/lib/api/types';

/**
 * Which event a coach or staff member is registering for. Only shown when there is a real choice: with one open event (or
 * a team invite, which names its event) the form stays exactly as it was. With none, registering is not possible yet.
 */
export default function PersonnelEventField({
  events,
  eventId,
  onChange,
  error,
  hidden,
  onBlur
}: {
  events: ApiEvent[];
  eventId: string;
  onChange: (id: string) => void;
  error?: string | null;
  /** The event is already decided (a team invite names it). */
  hidden: boolean;
  onBlur?: () => void;
}) {
  if (hidden) return null;
  if (events.length === 0) {
    return (
      <Alert level="warning" title="No event is open for registration">
        Registration isn’t open for any event right now. Please check back soon.
      </Alert>
    );
  }
  if (events.length === 1) return null;
  return (
    <SelectField id="eventId" label="Event" value={eventId} error={error} onBlur={onBlur} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select an event</option>
      {events.map((ev) => (
        <option key={ev.id} value={ev.id}>
          {ev.name}
        </option>
      ))}
    </SelectField>
  );
}
