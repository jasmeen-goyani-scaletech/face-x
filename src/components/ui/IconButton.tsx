import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * Compact icon-only button. `label` is the accessible name (screen readers, e.g. "Preview Birth Certificate");
 * `tooltip` is the short text shown on hover or keyboard focus (defaults to `label`). Touch screens have no
 * hover, so the tooltip is hidden there rather than sticking after a tap.
 */
export default function IconButton({
  label,
  tooltip,
  tone = 'neutral',
  prominent,
  loading,
  className = '',
  children,
  disabled,
  ...rest
}: {
  label: string;
  tooltip?: string;
  /** `danger` / `success` tint on hover. */
  tone?: 'neutral' | 'danger' | 'success';
  /** Show the tone colour at rest too (e.g. approve / reject), not only on hover. */
  prominent?: boolean;
  /** Swaps the icon for a spinner and disables the button. */
  loading?: boolean;
  children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'>) {
  return (
    <button
      type="button"
      aria-label={label}
      className={[
        'group relative flex h-11 w-11 shrink-0 sm:h-8 sm:w-8 items-center justify-center rounded-s border border-line-strong bg-surface text-ink-soft transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-55',
        tone === 'danger'
          ? ['enabled:hover:border-danger enabled:hover:bg-danger-soft enabled:hover:text-danger', prominent ? 'text-danger' : ''].join(' ')
          : tone === 'success'
            ? ['enabled:hover:border-success enabled:hover:bg-success-soft enabled:hover:text-success', prominent ? 'text-success' : ''].join(' ')
            : 'enabled:hover:bg-surface-2 enabled:hover:text-ink',
        className
      ].join(' ')}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" /> : children}
      <span
        aria-hidden="true"
        className={[
          'pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-s bg-ink px-2 py-1',
          'text-[11.5px] font-semibold leading-none text-surface opacity-0 shadow-md transition-opacity duration-150',
          'group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:hidden'
        ].join(' ')}
      >
        {tooltip ?? label}
      </span>
    </button>
  );
}
