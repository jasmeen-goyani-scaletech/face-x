import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'dangerOutline';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  block?: boolean;
  loading?: boolean;
  /** `sm` is a compact button for dense UI such as table rows. */
  size?: 'md' | 'sm';
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary-hover',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-surface-2',
  ghost: 'bg-transparent text-primary-strong hover:bg-primary-light',
  danger: 'bg-danger text-white hover:brightness-95',
  success: 'bg-success text-white hover:brightness-95',
  dangerOutline: 'bg-surface text-danger border border-danger hover:bg-danger-soft'
};

export default function Button({ variant = 'primary', block, loading, size = 'md', disabled, className = '', children, ...rest }: ButtonProps) {
  return (
    <button
      className={[
        'inline-flex items-center justify-center gap-2 rounded-s',
        size === 'sm' ? 'min-h-[34px] px-2 py-1.5 text-[13px] sm:px-3' : 'touch-target px-5 py-2.5',
        'font-body font-bold transition active:translate-y-px disabled:opacity-55 disabled:cursor-not-allowed',
        size === 'sm' ? '' : 'text-sm',
        VARIANT_CLASSES[variant],
        block ? 'w-full' : '',
        className
      ].join(' ')}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden />}
      {children}
    </button>
  );
}
