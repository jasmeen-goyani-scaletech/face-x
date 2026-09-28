import type { InputHTMLAttributes, SelectHTMLAttributes } from 'react';

interface FieldShellProps {
  label: string;
  htmlFor: string;
  optional?: boolean;
  error?: string;
  children: React.ReactNode;
}

export function FieldShell({ label, htmlFor, optional, error, children }: FieldShellProps) {
  return (
    <div className="flex flex-col gap-1.5 mb-4">
      <label htmlFor={htmlFor} className="text-[12.5px] font-semibold text-ink">
        {label}
        {optional ? (
          <span className="ml-1.5 font-medium text-ink-faint normal-case text-[11.5px]">(optional)</span>
        ) : (
          <span className="text-danger ml-0.5">*</span>
        )}
      </label>
      {children}
      {error && <div className="text-[12px] font-semibold text-danger">{error}</div>}
    </div>
  );
}

const inputClass =
  'w-full rounded-s border px-3 py-2.5 text-[14.5px] bg-surface text-ink font-body ' +
  'focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent';

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  optional?: boolean;
  error?: string;
}

export function TextField({ label, optional, error, id, className = '', ...rest }: TextFieldProps) {
  return (
    <FieldShell label={label} htmlFor={id!} optional={optional} error={error}>
      <input id={id} className={[inputClass, error ? 'border-danger' : 'border-line-strong', className].join(' ')} {...rest} />
    </FieldShell>
  );
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  optional?: boolean;
  error?: string;
}

export function SelectField({ label, optional, error, id, className = '', children, ...rest }: SelectFieldProps) {
  return (
    <FieldShell label={label} htmlFor={id!} optional={optional} error={error}>
      <select id={id} className={[inputClass, error ? 'border-danger' : 'border-line-strong', className].join(' ')} {...rest}>
        {children}
      </select>
    </FieldShell>
  );
}
