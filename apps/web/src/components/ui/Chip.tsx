type Kind = 'neutral' | 'outline' | 'info' | 'success' | 'warning' | 'danger';

const KIND_CLASSES: Record<Kind, string> = {
  neutral: 'bg-surface-2 text-ink-soft',
  outline: 'border border-line-strong bg-transparent text-ink-soft',
  info: 'bg-info-soft text-info',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger'
};

export default function Chip({ kind = 'neutral', compact, children }: { kind?: Kind; /** Tighter padding, for dense grids and tables. */ compact?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full text-[11px] font-bold uppercase tracking-wide whitespace-nowrap',
        compact ? 'px-2 py-0.5' : 'px-2.5 py-1',
        KIND_CLASSES[kind]
      ].join(' ')}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function reviewChip(review: 'not_submitted' | 'pending' | 'approved' | 'rejected' | 'uploaded' | 'missing') {
  if (review === 'approved') return <Chip kind="success">Approved</Chip>;
  if (review === 'rejected') return <Chip kind="danger">Rejected</Chip>;
  if (review === 'pending') return <Chip kind="warning">Pending review</Chip>;
  if (review === 'uploaded' || review === 'not_submitted') return <Chip kind="success">Uploaded</Chip>;
  return <Chip kind="outline">Not uploaded</Chip>;
}
