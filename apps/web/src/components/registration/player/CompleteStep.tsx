import Link from 'next/link';
import Card from '@/components/ui/Card';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import { CheckIcon, ChevronRightIcon } from '@/components/ui/Icons';
import { formatDateTime } from '@/lib/format';
import type { ApiPaymentSummary, ApiRegistration } from '@/lib/api/types';

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function CompleteStep({ registration, payment }: { registration: ApiRegistration; payment: ApiPaymentSummary | null }) {
  const paidPayment = payment?.payments.find((p) => p.status === 'PAID');
  const noFee = registration.fee.amountCents === 0;
  const paid = payment?.paymentStatus === 'PAID';
  const closed = registration.status === 'CANCELLED' || registration.status === 'REJECTED';

  return (
    <Card className="text-center">
      <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-success-soft text-success border-2 border-success">
        <CheckIcon size={34} />
      </div>
      <h1 className="text-2xl mb-2">Registration Submitted</h1>
      <p className="text-ink-soft mb-1">
        Registration for{' '}
        <strong>
          {registration.player.firstName} {registration.player.lastName}
        </strong>{' '}
        has been received.
      </p>
      <p className="text-[13px] text-ink-faint mb-5">Registration number {registration.registrationNumber}</p>

      {closed && (
        <div className="mb-5">
          <Alert level="warning" title={registration.status === 'CANCELLED' ? 'Registration cancelled' : 'Registration not accepted'}>
            This registration is no longer active. Contact the league if you think this is a mistake.
          </Alert>
        </div>
      )}
      {!closed && paid && (
        <div className="mb-5">
          <Alert level="success" title="Payment received">
            {money(paidPayment?.amountCents ?? registration.fee.amountCents)} registration fee paid
            {paidPayment?.paidAt ? ` on ${formatDateTime(Date.parse(paidPayment.paidAt))}` : ''}.
          </Alert>
        </div>
      )}
      {!closed && !paid && noFee && (
        <div className="mb-5">
          <Alert level="success" title="No payment needed">
            There is no registration fee for this event.
          </Alert>
        </div>
      )}
      {!closed && !paid && !noFee && (
        <div className="mb-5">
          <Alert level="warning" title="Payment pending">
            We haven&rsquo;t received your payment yet. You can finish paying from your status dashboard.
          </Alert>
        </div>
      )}
      {registration.status === 'READY_FOR_EVENT' ? (
        <Alert level="success" title="Cleared for the event">
          Everything has been reviewed and approved: {registration.player.firstName} is ready for event-day check-in.
        </Alert>
      ) : (
        !closed && (
          <Alert level="info" title="What happens next">
            Registration isn&rsquo;t the finish line. Our staff still needs to manually review the uploaded documents and confirm consent before{' '}
            {registration.player.firstName} is cleared for the event. Track progress on your status dashboard.
          </Alert>
        )
      )}
      <Link href="/dashboard/player">
        <Button variant="primary" block>
          View Registration Status <ChevronRightIcon size={16} />
        </Button>
      </Link>
    </Card>
  );
}
