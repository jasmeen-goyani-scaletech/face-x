import type { ReactNode } from 'react';
import Card from '@/components/ui/Card';
import Chip from '@/components/ui/Chip';
import Button from '@/components/ui/Button';

/**
 * The one card for every admin decision on a review page (registration decision, compliance flags, ...).
 *
 *   ┌───────────────────────────────────────────────────────────┐
 *   │ TITLE                                     [Reject] [Approve] │   ← title + helper text left, actions right
 *   │ helper text                                                │
 *   │ notice (e.g. "Currently rejected")                         │   ← optional, full width
 *   │ children (e.g. the rejection-reason form)                  │   ← optional, full width
 *   └───────────────────────────────────────────────────────────┘
 *
 * Actions sit on the right from 640px, matching the Actions column of the document table above. On phones they stack
 * full-width under the text. Button hierarchy for callers: Button `primary` for the approving action, `dangerOutline`
 * for rejecting, `secondary` for anything else. Buttons are sized by this wrapper, so callers don't add width classes.
 */
export default function AdminDecisionSection({
  title,
  description,
  notice,
  actions,
  children
}: {
  title: string;
  description?: ReactNode;
  notice?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <h2 className="m-0 mb-1 text-lg">{title}</h2>
          {description && <div className="text-sm text-ink-soft">{description}</div>}
        </div>
        {actions && (
          <div className="flex flex-col gap-2 sm:shrink-0 sm:flex-row sm:justify-end sm:gap-3 [&>button]:w-full sm:[&>button]:w-auto">{actions}</div>
        )}
      </div>
      {notice && <div className="mt-4">{notice}</div>}
      {children && <div className="mt-4">{children}</div>}
    </Card>
  );
}

/** Open compliance flags on a record, with the approving action on the right. Used by the Player, Coach and Staff pages. */
export function ComplianceFlagsSection({ flags, onClearAndApprove }: { flags: string[]; onClearAndApprove: () => void }) {
  return (
    <AdminDecisionSection
      title="Compliance flags"
      description={
        flags.length > 0 ? (
          <>
            <p className="m-0">Open flags on this record:</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {flags.map((f) => (
                <Chip key={f} kind="warning">
                  {f}
                </Chip>
              ))}
            </div>
          </>
        ) : (
          'No outstanding compliance flags.'
        )
      }
      actions={
        flags.length > 0 ? (
          <Button variant="primary" onClick={onClearAndApprove}>
            Clear Flags & Approve
          </Button>
        ) : undefined
      }
    />
  );
}
