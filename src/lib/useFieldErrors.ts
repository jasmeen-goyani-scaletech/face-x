'use client';

import { useCallback, useState } from 'react';

/**
 * Moves keyboard focus to the element with this id and smoothly scrolls it to the middle of the screen.
 * Waits a frame so error messages rendered by the same click have settled first (they change the layout above the
 * target). Focus uses `preventScroll` so the page doesn't jump before the smooth scroll starts; users who prefer
 * reduced motion get an instant scroll instead.
 */
export function focusAndScroll(id: string) {
  window.requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (!el) return;
    el.focus({ preventScroll: true });
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
  });
}

/**
 * Standard timing for showing validation errors, shared by every form.
 *
 * The caller computes `errors` from its current values on every render (a pure function). This hook only decides
 * which of them are *visible*:
 *  - a field's error shows once the field has been left (blur), or after the first submit attempt;
 *  - nothing shows while the user is typing in a field they haven't left yet;
 *  - because visibility is derived, an error disappears the instant the value becomes valid.
 *
 * Error keys must equal the id of the element to focus (an input, or the Upload button of a document row), so
 * `submit()` can scroll to and focus the first invalid field in `order`. Every invalid field shows its error at once.
 */
export function useFieldErrors<K extends string>(errors: Partial<Record<K, string>>, order: readonly K[]) {
  const [touched, setTouched] = useState<Partial<Record<K, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);

  /** The message to display for a field, or undefined. Pass straight to `error={...}`. */
  const error = (key: K): string | undefined => (submitted || touched[key] ? errors[key] : undefined);

  /** `onBlur={blur('email')}` */
  const blur = (key: K) => () => setTouched((t) => (t[key] ? t : { ...t, [key]: true }));

  /** Reveals every error and focuses the first invalid field. Returns true when the form is valid and can proceed. */
  function submit(): boolean {
    setSubmitted(true);
    const first = order.find((key) => errors[key]);
    if (!first) return true;
    focusAndScroll(first);
    return false;
  }

  /** Back to a pristine form, e.g. after a successful create or when a panel is closed. */
  const reset = useCallback(() => {
    setTouched({});
    setSubmitted(false);
  }, []);

  return { error, blur, submit, reset };
}
