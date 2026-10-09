import type { RegistrationRole } from '@/lib/activeRole';

/** Per-role colour coding, shared by the top bar, the role selector and the portal. Built from theme tokens only. */
export const ROLE_TONE: Record<RegistrationRole, { label: string; badge: string; dot: string }> = {
  player: { label: 'Player', badge: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-primary-light dark:text-primary-strong dark:border-primary/25', dot: 'bg-emerald-600' },
  coach: { label: 'Coach', badge: 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-info-soft dark:text-info dark:border-info/25', dot: 'bg-blue-600' },
  staff: { label: 'Staff', badge: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-gold-soft dark:text-gold dark:border-gold/30', dot: 'bg-amber-600' }
};

export default function RoleBadge({ role, className = '' }: { role: RegistrationRole; className?: string }) {
  const tone = ROLE_TONE[role];
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-display text-[11px] font-bold uppercase leading-5 tracking-wider',
        tone.badge,
        className
      ].join(' ')}
    >
      <span aria-hidden="true" className={['h-1.5 w-1.5 rounded-full', tone.dot].join(' ')} />
      {tone.label}
    </span>
  );
}
