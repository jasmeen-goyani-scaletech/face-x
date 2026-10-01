import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import FormFieldWrapper, { fieldAria, fieldControlClass, fieldStateClass } from './FormFieldWrapper';

interface BaseFieldProps {
  label: string;
  /** Shows "(optional)" instead of the required `*`. */
  optional?: boolean;
  /** Explanation in an (i) popover next to the label. */
  tooltip?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
}

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement>, BaseFieldProps {}

export function TextField({ label, optional, tooltip, hint, error, id, className = '', ...rest }: TextFieldProps) {
  return (
    <FormFieldWrapper id={id!} label={label} marker={optional ? 'optional' : 'required'} tooltip={tooltip} hint={hint} error={error}>
      <input id={id} className={[fieldControlClass, fieldStateClass(!!error), className].join(' ')} {...fieldAria(id!, error, hint)} {...rest} />
    </FormFieldWrapper>
  );
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement>, BaseFieldProps {}

export function SelectField({ label, optional, tooltip, hint, error, id, className = '', children, ...rest }: SelectFieldProps) {
  return (
    <FormFieldWrapper id={id!} label={label} marker={optional ? 'optional' : 'required'} tooltip={tooltip} hint={hint} error={error}>
      <select id={id} className={[fieldControlClass, fieldStateClass(!!error), className].join(' ')} {...fieldAria(id!, error, hint)} {...rest}>
        {children}
      </select>
    </FormFieldWrapper>
  );
}
