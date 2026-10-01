import type { DetailSection } from './AdminOverviewTab';
import { formatDate, formatDateTime } from '@/lib/format';
import { MIN_PLAYER_AGE } from '@/lib/age';
import type { RosterEntry } from '@/lib/seed';
import type { CoachRegistration, PlayerRegistration, StaffRegistration } from '@/lib/types';

/**
 * What an admin sees on the Overview tab: the person's details, built only from fields the registration forms actually
 * collect, and nothing that is shown elsewhere.
 *
 *   - Account standing (registration, event-day access, payment, open flags) is in the profile header (AccountStatusBar).
 *   - Whether each photo / certificate / document is uploaded or approved is on the Photos & Documents tab.
 *
 * So there are no status pills here. Fields the forms don't ask for (gender, T-shirt size, position, home address,
 * medical notes, media release, payment transaction id / method) are deliberately absent, so nothing on screen is blank or
 * invented. When a form gains a field, add it here. Remarks go in `note`s, shown together in one info bar.
 */

const fullName = (b: { firstName: string; lastName: string }) => `${b.firstName} ${b.lastName}`.trim();
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Seeded roster rows have no registration form behind them, only the roster fields. */
export function rosterOnlySections(entry: RosterEntry, age: number | null): DetailSection[] {
  return [
    {
      title: 'Profile & account',
      items: [
        { label: 'Full name', value: fullName(entry) },
        { label: 'Registration ID', value: entry.schoolId },
        { label: 'Team', value: entry.teamName || 'No team assigned' },
        { label: 'Role', value: cap(entry.role) },
        ...(entry.role === 'player'
          ? [
              { label: 'Date of birth', value: formatDate(entry.dob) },
              { label: 'Age · Division', value: `${age ?? '—'} · ${entry.division || '—'}` }
            ]
          : []),
        ...(entry.pendingReason ? [{ label: 'Pending reason', value: entry.pendingReason, wide: true }] : [])
      ],
      note: 'Sample record: only roster details are on file. The full registration form is stored for registrations submitted in this app.'
    }
  ];
}

export function playerSections(reg: PlayerRegistration, entry: RosterEntry, age: number | null): DetailSection[] {
  const g = reg.emergency;
  const c = reg.consent;
  const p = reg.payment;
  const isMinor = age === null || age < 18;

  const sections: DetailSection[] = [
    {
      title: 'Profile & account',
      items: [
        { label: 'Full name', value: fullName(reg.basic) },
        { label: 'Registration ID', value: entry.schoolId },
        { label: 'Team', value: entry.teamName || 'No team assigned' },
        { label: 'Role', value: 'Player' },
        { label: 'Date of birth', value: formatDate(reg.basic.dob) },
        { label: 'Age · Division', value: `${age ?? '—'} · ${entry.division || '—'}${age !== null && age < MIN_PLAYER_AGE ? ' (below minimum age)' : ''}` },
        { label: 'Mobile', value: reg.basic.phone },
        { label: 'Email', value: reg.basic.email },
        { label: 'Submitted', value: formatDateTime(reg.completedAt ?? reg.createdAt) },
        { label: 'Guests attending', value: String(g.guestCount ?? 0) }
      ]
    }
  ];

  if (isMinor) {
    sections.push({
      title: 'Guardian & consent',
      items: [
        { label: 'Parent / guardian', value: g.guardianName },
        { label: 'Relationship', value: g.relationship },
        { label: 'Phone', value: g.guardianPhone },
        { label: 'Email', value: g.guardianEmail },
        { label: 'Digital signature', value: c.signedName },
        { label: 'Signed', value: c.completedAt ? formatDateTime(c.completedAt) : '—' }
      ]
    });
  }

  sections.push({
    title: 'Payment',
    items: [
      { label: 'Amount', value: `$${p.amount.toFixed(2)}` },
      { label: 'Paid', value: p.paidAt ? formatDateTime(p.paidAt) : '—' },
      ...(p.failReason ? [{ label: 'Failure reason', value: p.failReason, wide: true }] : [])
    ],
    note: isMinor
      ? 'Payments are taken on an external platform, so the transaction ID and payment method are not stored here.'
      : 'Player is 18 or older, so guardian details and the waiver were not required. Payments are taken on an external platform, so the transaction ID and payment method are not stored here.'
  });

  return sections;
}

export function coachSections(reg: CoachRegistration, entry: RosterEntry): DetailSection[] {
  return [
    {
      title: 'Profile & account',
      items: [
        { label: 'Full name', value: fullName(reg.basic) },
        { label: 'Registration ID', value: reg.id },
        { label: 'Team', value: entry.teamName || 'No team assigned' },
        { label: 'Role', value: 'Coach' },
        { label: 'Mobile', value: reg.basic.phone },
        { label: 'Email', value: reg.basic.email },
        { label: 'Submitted', value: formatDateTime(reg.createdAt) },
        { label: 'Team created by coach', value: reg.team?.teamName },
        ...(reg.adminStatus === 'rejected' && reg.rejectionReason ? [{ label: 'Rejection reason', value: reg.rejectionReason, wide: true }] : [])
      ]
    }
  ];
}

export function staffSections(reg: StaffRegistration, entry: RosterEntry): DetailSection[] {
  return [
    {
      title: 'Profile & account',
      items: [
        { label: 'Full name', value: fullName(reg.basic) },
        { label: 'Registration ID', value: reg.id },
        { label: 'Team', value: entry.teamName || 'No team assigned' },
        { label: 'Role', value: reg.role ?? 'Staff' },
        { label: 'Mobile', value: reg.basic.phone },
        { label: 'Email', value: reg.basic.email },
        { label: 'Submitted', value: formatDateTime(reg.createdAt) },
        ...(reg.adminStatus === 'rejected' && reg.rejectionReason ? [{ label: 'Rejection reason', value: reg.rejectionReason, wide: true }] : [])
      ]
    }
  ];
}
