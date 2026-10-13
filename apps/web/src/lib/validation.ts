/**
 * Platform-wide validation rules and copy, shared by the player, coach and staff registration forms and the admin forms.
 * Each validator returns an actionable message, or null when the value is fine. Keep all user-facing wording here so
 * the same mistake reads the same on every form.
 */
export const MSG = {
  firstName: 'Please enter your first name.',
  lastName: 'Please enter your last name.',
  phone: 'Please enter a valid 10-digit phone number (e.g., 555-019-2831).',
  email: 'Please enter a valid email address (e.g., name@example.com).',
  team: 'Please select a team to proceed.',
  role: 'Please select a role to proceed.',
  dobRequired: 'Please enter the player’s date of birth.',
  photo: 'Please capture or upload a face selfie to proceed.'
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/** 10 digits, or 11 with a leading US country code. Only digits, spaces and + ( ) . - may be typed. */
export function isValidPhone(value: string): boolean {
  if (!/^[+\d\s().-]+$/.test(value.trim())) return false;
  const digits = value.replace(/\D/g, '');
  return digits.length === 10 || (digits.length === 11 && digits.startsWith('1'));
}

export const validators = {
  firstName: (v: string) => (v.trim() ? null : MSG.firstName),
  lastName: (v: string) => (v.trim() ? null : MSG.lastName),
  phone: (v: string) => (isValidPhone(v) ? null : MSG.phone),
  email: (v: string) => (isValidEmail(v) ? null : MSG.email)
};

export type FieldErrors<K extends string = string> = Partial<Record<K, string>>;

/** Drops the null results so the object only contains fields that are actually invalid. */
export function compact<K extends string>(entries: Record<K, string | null | undefined>): FieldErrors<K> {
  const out: FieldErrors<K> = {};
  for (const key of Object.keys(entries) as K[]) {
    const message = entries[key];
    if (message) out[key] = message;
  }
  return out;
}

/** The four details every registration collects. Keys match the input ids so submit can focus the first invalid one. */
export function validatePersonBasics(b: { firstName: string; lastName: string; phone: string; email: string }) {
  return compact({
    firstName: validators.firstName(b.firstName),
    lastName: validators.lastName(b.lastName),
    phone: validators.phone(b.phone),
    email: validators.email(b.email)
  });
}
