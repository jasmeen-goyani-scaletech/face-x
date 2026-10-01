'use client';

import { useRef, type ReactNode } from 'react';
import InfoTooltip from './InfoTooltip';

/** Standard error text: accessible red, medium weight. For error messages that live outside a FormFieldWrapper. */
export function FieldError({ id, children, className = '' }: { id?: string; children: ReactNode; className?: string }) {
  return (
    <p id={id} role="alert" className={['m-0 text-sm font-medium leading-5 text-field-error', className].join(' ')}>
      {children}
    </p>
  );
}

/** Classes for the control inside a FormFieldWrapper. Focus colour is set here, not in the base, so the two never fight. */
export const fieldControlClass =
  'w-full rounded-s border px-3 py-2.5 text-[14.5px] bg-surface text-ink font-body focus:outline-none focus:ring-2 ' +
  'transition-colors';

export function fieldStateClass(invalid: boolean): string {
  return invalid
    ? 'border-field-error focus:ring-field-error focus:border-field-error'
    : 'border-line-strong focus:ring-primary focus:border-primary';
}

/** Wire these onto the control so screen readers announce the hint and the error with it. */
export function fieldAria(id: string, error?: string | null, hint?: ReactNode) {
  return {
    'aria-invalid': error ? (true as const) : undefined,
    'aria-describedby': [hint ? `${id}-hint` : '', `${id}-error`].filter(Boolean).join(' ')
  };
}

/**
 * One layout for every form field: label + required marker + optional tooltip, the control, an optional hint, and the
 * error message.
 *
 * The error row always reserves one line of height, so a one-line error never moves the controls below it. Longer messages
 * grow the row with a short animation instead of snapping, and the text fades out rather than vanishing mid-collapse.
 */
export default function FormFieldWrapper({
  id,
  label,
  marker = 'required',
  tooltip,
  hint,
  error,
  className = '',
  children
}: {
  /** The id of the control inside, so the label is clickable and the error is associated. */
  id: string;
  label: string;
  /** `required` shows `*`, `optional` shows "(optional)", `none` shows nothing. */
  marker?: 'required' | 'optional' | 'none';
  /** Explanation shown in an (i) popover next to the label — hover on desktop, tap on touch. */
  tooltip?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
  children: ReactNode;
}) {
  const open = !!error;
  // Keep the last message so the text can fade while the row collapses.
  const lastError = useRef('');
  if (error) lastError.current = error;

  return (
    <div className={['flex flex-col', className].join(' ')}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <label htmlFor={id} className="text-[12.5px] font-semibold text-ink">
          {label}
          {marker === 'required' && (
            <span aria-hidden="true" className="ml-0.5 text-field-error">
              *
            </span>
          )}
          {marker === 'optional' && <span className="ml-1.5 text-[11.5px] font-medium normal-case text-ink-faint">(optional)</span>}
        </label>
        {tooltip && <InfoTooltip label={label}>{tooltip}</InfoTooltip>}
      </div>

      {children}

      {hint && (
        <p id={`${id}-hint`} className="m-0 mt-1.5 text-[12.5px] text-ink-faint">
          {hint}
        </p>
      )}

      <div
        id={`${id}-error`}
        aria-live="polite"
        className={[
          'mt-1 grid min-h-5 transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        ].join(' ')}
      >
        <div className="overflow-hidden">
          <p aria-hidden={!open} className="m-0 text-sm font-medium leading-5 text-field-error">
            {open ? error : lastError.current}
          </p>
        </div>
      </div>
    </div>
  );
}
