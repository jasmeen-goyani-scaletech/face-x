'use client';

import { useEffect, useId, useState } from 'react';
import Button from '@/components/ui/Button';
import Dialog from '@/components/ui/Dialog';
import { REJECTION_REASONS, type RejectionReasonCode } from '@/lib/documentVerification';

const FIELD =
  'w-full rounded-s border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary';

/**
 * Asks why a document is being rejected. A preset reason is required and pre-fills the note, which the
 * admin can edit; the note is required too, since it's the text the user is shown.
 */
export default function RejectionDialog({
  open,
  documentLabel,
  pending = false,
  error,
  onCancel,
  onConfirm
}: {
  open: boolean;
  documentLabel: string;
  pending?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (reason: { code: RejectionReasonCode; text: string }) => void;
}) {
  const titleId = useId();
  const selectId = useId();
  const noteId = useId();
  const [code, setCode] = useState<RejectionReasonCode | ''>('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (open) {
      setCode('');
      setNote('');
    }
  }, [open]);

  function choose(next: RejectionReasonCode | '') {
    setCode(next);
    const preset = REJECTION_REASONS.find((r) => r.code === next);
    // Pre-fill (or clear, for Custom) so the admin starts from useful wording but can edit it freely.
    if (preset) setNote(preset.template);
  }

  const canSubmit = code !== '' && note.trim().length > 0;

  return (
    <Dialog open={open} onClose={onCancel} labelledBy={titleId} size="md" busy={pending} initialFocus="select">
      <h2 id={titleId} className="text-lg mb-1 text-ink">
        Reject Document
      </h2>
      <p className="mt-0 mb-4 text-sm text-ink-soft">
        <strong className="text-ink">{documentLabel}</strong> will be marked rejected and the user will be asked to upload a new one. The reason below is sent
        to them.
      </p>

      <label htmlFor={selectId} className="block text-[12.5px] font-semibold text-ink mb-1.5">
        Reason <span className="text-danger">*</span>
      </label>
      <select id={selectId} value={code} onChange={(e) => choose(e.target.value as RejectionReasonCode | '')} className={FIELD} disabled={pending}>
        <option value="">Select a reason…</option>
        {REJECTION_REASONS.map((r) => (
          <option key={r.code} value={r.code}>
            {r.label}
          </option>
        ))}
      </select>

      <label htmlFor={noteId} className="block text-[12.5px] font-semibold text-ink mt-4 mb-1.5">
        Message to the user <span className="text-danger">*</span>
      </label>
      <textarea
        id={noteId}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        maxLength={300}
        placeholder="Explain what's wrong so they know what to re-upload…"
        className={FIELD}
        disabled={pending}
      />
      <p className="mt-1 mb-0 text-right text-[11.5px] text-ink-faint">{note.length}/300</p>

      {error && (
        <p role="alert" className="mt-3 mb-0 rounded-s bg-danger-soft px-3 py-2 text-[13px] font-semibold text-danger">
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button variant="danger" onClick={() => canSubmit && onConfirm({ code: code as RejectionReasonCode, text: note.trim() })} disabled={!canSubmit} loading={pending}>
          Confirm Rejection
        </Button>
      </div>
    </Dialog>
  );
}
