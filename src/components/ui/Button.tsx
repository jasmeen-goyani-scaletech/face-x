import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  block?: boolean;
  loading?: boolean;
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:brightness-95',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-surface-2',
  ghost: 'bg-transparent text-accent-strong hover:bg-accent-soft',
  danger: 'bg-danger text-white hover:brightness-95'
};

export default function Button({
  variant = 'primary',
  block,
  loading,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={[
        'touch-target inline-flex items-center justify-center gap-2 rounded-s px-5 py-2.5',
        'font-body font-bold text-sm transition active:translate-y-px disabled:opacity-55 disabled:cursor-not-allowed',
        VARIANT_CLASSES[variant],
        block ? 'w-full' : '',
        className
      ].join(' ')}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && (
        <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden />
      )}
      {children}
    </button>
  );
}
