import { AlertTriangleIcon } from '@/components/ui/Icons';
import { dobAge, INVALID_DOB_MESSAGE } from '@/lib/age';

/**
 * The player's age, worked out from the date of birth above: just the number of years, nothing else.
 * No age division (U12, U14, ...) is shown here. Divisions are for the roster, not this form.
 *
 *  - Nothing chosen yet → a prompt to pick a date.
 *  - A real past date   → "12 years old", exact to the day (a birthday not yet reached this year counts one less).
 *  - Not a real date, a future date, or an implausibly old one → a warning.
 * A player younger than the minimum age still shows their age here; the registration rule about the minimum is reported on
 * the date-of-birth field itself.
 */
export default function PlayerAgeCalculatorField({ dob }: { dob: string }) {
  const result = dobAge(dob);

  return (
    <div className="mb-4" aria-live="polite">
      <div id="calculated-age-label" className="mb-1.5 text-[12.5px] font-semibold text-ink">
        Age
      </div>
      {result.state === 'empty' && (
        <div aria-labelledby="calculated-age-label" className="rounded-m border border-dashed border-line-strong bg-surface-2 px-4 py-3 text-sm text-ink-faint">
          Select Date of Birth to calculate age
        </div>
      )}
      {result.state === 'invalid' && (
        <div aria-labelledby="calculated-age-label" className="flex items-center gap-2 rounded-m border border-warning bg-warning-soft px-4 py-3 text-sm font-semibold text-warning">
          <AlertTriangleIcon size={16} className="shrink-0" /> {INVALID_DOB_MESSAGE}
        </div>
      )}
      {result.state === 'ok' && (
        <div aria-labelledby="calculated-age-label" className="flex items-center justify-between gap-3 rounded-m bg-primary-light px-4 py-3 text-sm">
          <span className="font-semibold text-primary-strong">
            {result.age} {result.age === 1 ? 'year' : 'years'} old
          </span>
          <span className="text-[11.5px] text-primary-strong opacity-80">Calculated automatically</span>
        </div>
      )}
    </div>
  );
}
