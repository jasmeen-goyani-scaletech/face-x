'use client';

import { useId, type ReactNode } from 'react';
import Button from './Button';
import Dialog from './Dialog';

/**
 * Confirmation dialog (WAI-ARIA `alertdialog`) for destructive or high-impact actions.
 * Focus starts on Cancel (the safe choice). If the action fails, pass `error`: the dialog stays open,
 * shows it, and the user can retry.
 */
export default function ConfirmDialog({
  open,
  title,
  description,
  note,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  pending = false,
  error,
  onConfirm,
  onCancel
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  /** Optional secondary line, e.g. how to undo the action. */
  note?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const descId = useId();

  return (
    <Dialog open={open} onClose={onCancel} labelledBy={titleId} describedBy={descId} role="alertdialog" busy={pending} initialFocus="button">
      <h2 id={titleId} className="text-lg mb-2 text-ink">
        {title}
      </h2>
      <div id={descId} className="text-sm text-ink-soft">
        <p className="m-0">{description}</p>
        {note && <p className="mt-3 mb-0 rounded-s bg-surface-2 px-3 py-2 text-[13px]">{note}</p>}
      </div>
      {error && (
        <p role="alert" className="mt-3 mb-0 rounded-s bg-danger-soft px-3 py-2 text-[13px] font-semibold text-danger">
          {error}
        </p>
      )}
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel} disabled={pending}>
          {cancelLabel}
        </Button>
        <Button variant={tone} onClick={onConfirm} loading={pending}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
