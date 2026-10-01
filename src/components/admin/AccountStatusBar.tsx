import Chip from '@/components/ui/Chip';
import type { AccessState, RegistrationState } from '@/lib/accessCompliance';

export type PaymentState = 'complete' | 'incomplete' | 'failed';

/**
 * The account's standing, on one line in the profile header:
 *   Registration · Event-day access · Payment (players only) · open flags.
 * It is the only place these appear. Individual document statuses live on the Photos & Documents tab; the Overview tab
 * holds just the person's details. Each pill carries its own label, so "Registration: Approved" beside
 * "Event-day access: Disabled" reads as two separate facts rather than a contradiction.
 */
export default function AccountStatusBar({
  registration,
  access,
  payment,
  flags
}: {
  registration: RegistrationState;
  /** `blocked` = held back by compliance (amber); `disabled` = everything is clear but an admin has it switched off ("ready to enable"). */
  access: AccessState;
  /** Omit for coaches and staff, who don't pay. */
  payment?: PaymentState;
  flags: string[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Chip compact kind={registration === 'approved' ? 'success' : registration === 'rejected' ? 'danger' : 'warning'}>
        Registration: {registration === 'approved' ? 'Approved' : registration === 'rejected' ? 'Rejected' : 'Pending'}
      </Chip>
      <Chip compact kind={access === 'enabled' ? 'success' : access === 'blocked' ? 'warning' : 'neutral'}>
        Event-day access: {access === 'enabled' ? 'Enabled' : access === 'blocked' ? 'Disabled · Blocked by compliance' : 'Disabled · Ready to enable'}
      </Chip>
      {payment && (
        <Chip compact kind={payment === 'complete' ? 'success' : payment === 'failed' ? 'danger' : 'warning'}>
          Payment: {payment === 'complete' ? 'Complete' : payment === 'failed' ? 'Failed' : 'Pending'}
        </Chip>
      )}
      {flags.length > 0 ? (
        flags.map((f) => (
          <Chip key={f} compact kind="warning">
            {f}
          </Chip>
        ))
      ) : (
        <Chip compact kind="outline">
          No open flags
        </Chip>
      )}
    </div>
  );
}
