'use client';

import { useEffect, useState } from 'react';
import FormFieldWrapper, { fieldAria, fieldControlClass, fieldStateClass } from './FormFieldWrapper';
import { MAX_GUESTS, MIN_GUESTS } from '@/lib/guardianValidation';

/**
 * Whole-number guest count, typed directly (no +/- buttons, no native spinner: it's a text input with a numeric keypad).
 * Anything but digits is dropped as you type, so negatives and decimals can't be entered; values over the max snap to the
 * max; clearing the box saves 0 and shows "0" again on blur.
 */
export default function GuestCountInput({
  id,
  label,
  value,
  onChange,
  error
}: {
  id: string;
  label: string;
  value: number;
  onChange: (next: number) => void;
  error?: string | null;
}) {
  // Local text lets the box be empty while the user retypes, even though the stored value is always a number.
  const [text, setText] = useState(String(value));

  useEffect(() => {
    // Follow outside changes (e.g. a draft loading) without fighting an empty box the user is mid-edit on.
    if (text === '' ? value !== 0 : Number(text) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <FormFieldWrapper id={id} label={label} marker="none" error={error}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        maxLength={3}
        value={text}
        {...fieldAria(id, error)}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '');
          if (digits === '') {
            setText('');
            return onChange(MIN_GUESTS);
          }
          const n = Math.min(MAX_GUESTS, parseInt(digits, 10));
          setText(String(n));
          onChange(n);
        }}
        onBlur={() => text === '' && setText(String(MIN_GUESTS))}
        onFocus={(e) => e.target.select()}
        className={[fieldControlClass, fieldStateClass(!!error), '!w-24 tabular-nums'].join(' ')}
      />
    </FormFieldWrapper>
  );
}
