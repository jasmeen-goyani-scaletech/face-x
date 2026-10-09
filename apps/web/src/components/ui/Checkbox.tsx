import type { InputHTMLAttributes } from 'react';
import { CheckIcon } from './Icons';

/**
 * Checkbox in the brand colour, instead of the browser's default blue.
 * Unchecked: neutral border on the surface colour. Checked: filled with --primary and a --primary-foreground check.
 * Keyboard focus: a --primary ring. Invalid: the standard error border. Every colour is a theme token, so changing
 * --primary in globals.css re-colours every checkbox with no code change.
 *
 * It is the real <input>, so id, checked, onChange, onBlur, aria-* and labels (wrap it in a <label>) work as usual.
 * `className` goes on the outer wrapper, e.g. for a top margin that aligns it with the first line of text.
 */
export default function Checkbox({
  className = '',
  invalid,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { invalid?: boolean }) {
  return (
    <span className={['relative inline-flex h-[18px] w-[18px] shrink-0', className].join(' ')}>
      <input
        type="checkbox"
        aria-invalid={invalid ? true : undefined}
        className={[
          'peer h-full w-full cursor-pointer appearance-none rounded-[5px] border bg-surface transition-colors',
          invalid ? 'border-field-error' : 'border-line-strong',
          'checked:border-primary checked:bg-primary',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
          'disabled:cursor-not-allowed disabled:opacity-55'
        ].join(' ')}
        {...rest}
      />
      <CheckIcon
        size={13}
        strokeWidth={3}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 m-auto hidden text-primary-foreground peer-checked:block"
      />
    </span>
  );
}
