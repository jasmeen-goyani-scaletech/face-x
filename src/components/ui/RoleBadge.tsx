import type { RegistrationRole } from '@/lib/activeRole';

/** Per-role colour coding, shared by the top bar, the role selector and the portal. Built from theme tokens only. */
export const ROLE_TONE: Record<RegistrationRole, { label: string; badge: string; dot: string }> = {
  player: { label: 'Player', badge: 'bg-primary-light text-primary-strong border-primary/25', dot: 'bg-primary' },
  coach: { label: 'Coach', badge: 'bg-info-soft text-info border-info/25', dot: 'bg-info' },
  staff: { label: 'Staff', badge: 'bg-gold-soft text-gold border-gold/30', dot: 'bg-gold' }
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
