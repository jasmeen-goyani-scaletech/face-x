import Link from 'next/link';
import Card from '@/components/ui/Card';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import { CheckIcon, ChevronRightIcon } from '@/components/ui/Icons';
import { formatDateTime } from '@/lib/format';
import type { PlayerRegistration } from '@/lib/types';

export default function CompleteStep({ reg }: { reg: PlayerRegistration }) {
  return (
    <Card className="text-center">
      <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-success-soft text-success border-2 border-success">
        <CheckIcon size={34} />
      </div>
      <h1 className="text-2xl mb-2">Registration Submitted</h1>
      <p className="text-ink-soft mb-5">
        Registration for <strong>{reg.basic.firstName} {reg.basic.lastName}</strong> has been received.
      </p>
      {reg.payment.status === 'success' && (
        <div className="mb-5">
          <Alert level="success" title="Payment received">
            ${reg.payment.amount.toFixed(2)} registration fee paid{reg.payment.paidAt ? ` on ${formatDateTime(reg.payment.paidAt)}` : ''}.
          </Alert>
        </div>
      )}
      {reg.payment.status !== 'success' && (
        <div className="mb-5">
          <Alert level="warning" title="Payment pending">
            Online payments aren&rsquo;t open yet. Your registration details are saved, and we&rsquo;ll notify you once payment processing opens.
          </Alert>
        </div>
      )}
      <Alert level="info" title="What happens next">
        Registration isn&rsquo;t the finish line. Our staff still needs to manually review the uploaded documents and
        confirm consent before {reg.basic.firstName} is cleared for the event. Track progress on your status dashboard.
      </Alert>
      <Link href={`/dashboard/player`}>
        <Button variant="primary" block>
          View Registration Status <ChevronRightIcon size={16} />
        </Button>
      </Link>
    </Card>
  );
}
