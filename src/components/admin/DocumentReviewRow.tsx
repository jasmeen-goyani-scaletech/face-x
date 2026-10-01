'use client';

import { useState } from 'react';
import Chip from '@/components/ui/Chip';
import DocumentIconBox from '@/components/ui/DocumentIconBox';
import IconButton from '@/components/ui/IconButton';
import { AlertCircleIcon, CheckIcon, EditIcon, EyeIcon, XIcon } from '@/components/ui/Icons';
import { useToast } from '@/components/ui/Toast';
import DocumentPreviewDialog from './DocumentPreviewDialog';
import RejectionDialog from './RejectionDialog';
import PushNotificationPreview from './PushNotificationPreview';
import { DEMO_MODE } from '@/lib/demo/config';
import { CURRENT_ADMIN_ID, submitDocumentDecision, type DocumentNotification, type DocumentSubjectType } from '@/lib/documentVerification';
import { formatDateTime } from '@/lib/format';
import { formatFileSize } from '@/lib/playerDocuments';
import type { UploadedFile } from '@/lib/types';

export type VerificationStatus = 'NOT_UPLOADED' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';

export function documentStatus(file: UploadedFile): VerificationStatus {
  if (!file.uploaded) return 'NOT_UPLOADED';
  if (file.review === 'approved') return 'APPROVED';
  if (file.review === 'rejected') return 'REJECTED';
  return 'PENDING_REVIEW';
}

/**
 * Column template shared by the table header (DocumentReviewTable) and every row, so they line up. Four columns:
 * document, status, file (name over size · uploaded time), and a fixed-width action group. Below `xl` the rows stack.
 */
export const DOCUMENT_TABLE_COLUMNS = 'xl:grid-cols-[minmax(0,1.6fr)_132px_minmax(0,1.3fr)_128px]';

/** Soft tinted pills with solid text. Not-uploaded is a quiet outline. */
export function StatusChip({ status, compact }: { status: VerificationStatus; compact?: boolean }) {
  if (status === 'APPROVED') return <Chip compact={compact} kind="success">Approved</Chip>;
  if (status === 'REJECTED') return <Chip compact={compact} kind="danger">Rejected</Chip>;
  if (status === 'PENDING_REVIEW') return <Chip compact={compact} kind="warning">Pending review</Chip>;
  return <Chip compact={compact} kind="outline">Not uploaded</Chip>;
}

/**
 * One document in the admin review table: icon + name, status pill, file details, and a right-aligned group of icon
 * actions (preview, approve, reject — or just preview and "change decision" once decided), each with a tooltip.
 * A rejection is shown on the row itself: a left accent bar, a faint red tint, and the reason as a one-line subtitle
 * with an alert icon under the document name — no full-width banner.
 * Every decision goes through `submitDocumentDecision` (which triggers the user notification) before the parent's
 * `onApprove` / `onReject` update the registration. Used by the player, coach and staff detail views.
 */
export default function DocumentReviewRow({
  label,
  subtitle,
  value,
  documentId,
  subject,
  onApprove,
  onReject,
  readOnly = false
}: {
  label: string;
  /** e.g. "Required" / "Optional". */
  subtitle?: string;
  value: UploadedFile;
  /** Which document this is on the registration, e.g. `birthCertificate`. */
  documentId: string;
  subject: { type: DocumentSubjectType; id: string };
  onApprove: () => void;
  onReject: (reason: string) => void;
  /** The record is locked and approved: only Preview is offered, and no decision can be recorded. */
  readOnly?: boolean;
}) {
  const { notify } = useToast();
  const [previewing, setPreviewing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reopened, setReopened] = useState(false);
  const [pending, setPending] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [sent, setSent] = useState<DocumentNotification | null>(null); // Demo Mode: shows what the user would receive

  const status = documentStatus(value);
  const isRejected = status === 'REJECTED';
  const canDecide = status === 'PENDING_REVIEW' || (reopened && status !== 'NOT_UPLOADED');

  async function approve() {
    if (readOnly) return;
    setPending(true);
    try {
      const notification = await submitDocumentDecision({
        documentId,
        subjectType: subject.type,
        subjectId: subject.id,
        status: 'APPROVED',
        adminId: CURRENT_ADMIN_ID
      });
      onApprove();
      if (DEMO_MODE) setSent(notification);
      setReopened(false);
      notify(`${label} approved.`);
    } catch {
      notify('We couldn’t record that decision. Please try again.', 'danger');
    } finally {
      setPending(false);
    }
  }

  async function reject(reason: { code: Parameters<typeof submitDocumentDecision>[0]['rejectionReasonCode']; text: string }) {
    if (readOnly) return;
    setPending(true);
    setRejectError(null);
    try {
      const notification = await submitDocumentDecision({
        documentId,
        subjectType: subject.type,
        subjectId: subject.id,
        status: 'REJECTED',
        rejectionReasonCode: reason.code,
        rejectionReason: reason.text,
        adminId: CURRENT_ADMIN_ID
      });
      onReject(reason.text);
      if (DEMO_MODE) setSent(notification);
      setRejecting(false);
      setReopened(false);
      notify(`${label} rejected.`);
    } catch {
      setRejectError('We couldn’t record that decision. Please try again.'); // dialog stays open so nothing typed is lost
    } finally {
      setPending(false);
    }
  }

  const size = formatFileSize(value.size);
  const when = value.uploadedAt ? formatDateTime(value.uploadedAt) : null;
  const details = [size !== '—' ? size : null, when].filter(Boolean).join(' · ');

  return (
    <div
      role="row"
      aria-label={label}
      className={[
        'border-b border-l-4 border-line px-3 py-3 transition-colors first:rounded-t-m last:rounded-b-m last:border-b-0 sm:px-4',
        isRejected ? 'border-l-danger bg-danger-tint' : 'border-l-transparent hover:bg-surface-2'
      ].join(' ')}
    >
      <div className={['flex flex-wrap items-center gap-x-3 gap-y-2 xl:grid xl:min-h-[44px] xl:gap-4', DOCUMENT_TABLE_COLUMNS].join(' ')}>
        {/* Document: icon, name, and a one-line subtitle (the rejection reason when rejected, else Required / Optional) */}
        <div role="cell" className="flex w-full min-w-0 items-center gap-3 sm:w-auto sm:flex-1 xl:flex-none">
          <button
            type="button"
            onClick={() => setPreviewing(true)}
            disabled={!value.uploaded}
            aria-label={`Preview ${label}`}
            tabIndex={-1}
            className="shrink-0 rounded-s enabled:hover:ring-2 enabled:hover:ring-primary"
          >
            <DocumentIconBox documentId={documentId} file={value} />
          </button>
          <div className="min-w-0">
            <div className={['text-sm font-bold leading-snug', value.uploaded ? 'text-ink' : 'text-ink-soft'].join(' ')}>{label}</div>
            {isRejected ? (
              <p
                className="m-0 mt-0.5 flex items-start gap-1 text-xs font-medium leading-snug text-field-error"
                title={value.reason || 'Rejected'}
              >
                <AlertCircleIcon size={13} className="mt-px shrink-0" />
                <span className="xl:truncate">{value.reason || 'Rejected'}</span>
              </p>
            ) : (
              subtitle && <div className="text-xs leading-snug text-ink-faint">{subtitle}</div>
            )}
          </div>
        </div>

        {/* Status */}
        <div role="cell">
          <StatusChip status={status} />
        </div>

        {/* File: name over size · uploaded time (wide screens). Stacked layouts show it as one muted line below. */}
        <div role="cell" className="hidden min-w-0 text-[13px] xl:block">
          {value.uploaded ? (
            <>
              <div className="truncate font-semibold text-ink">{value.fileName}</div>
              {details && <div className="text-xs text-ink-faint">{details}</div>}
            </>
          ) : (
            <span className="text-ink-faint">—</span>
          )}
        </div>
        {value.uploaded && (
          <p className="m-0 min-w-0 flex-1 truncate text-xs text-ink-faint sm:w-full sm:flex-none xl:hidden">
            {[value.fileName, details].filter(Boolean).join(' · ')}
          </p>
        )}

        {/* Actions: right-aligned icon group */}
        <div role="cell" className="ml-auto flex items-center justify-end gap-1 xl:ml-0">
          {value.uploaded && (
            <>
              <IconButton label={`Preview ${label}`} tooltip="Preview" onClick={() => setPreviewing(true)}>
                <EyeIcon size={16} />
              </IconButton>
              {readOnly ? null : canDecide ? (
                <>
                  <IconButton
                    label={`Approve ${label}`}
                    tooltip="Approve"
                    tone="success"
                    prominent
                    loading={pending && !rejecting}
                    disabled={pending}
                    onClick={approve}
                  >
                    <CheckIcon size={16} strokeWidth={3} />
                  </IconButton>
                  <IconButton
                    label={`Reject ${label}`}
                    tooltip="Reject"
                    tone="danger"
                    prominent
                    disabled={pending}
                    onClick={() => setRejecting(true)}
                  >
                    <XIcon size={16} strokeWidth={3} />
                  </IconButton>
                </>
              ) : (
                <IconButton label={`Change decision for ${label}`} tooltip="Change decision" onClick={() => setReopened(true)}>
                  <EditIcon size={16} />
                </IconButton>
              )}
            </>
          )}
        </div>
      </div>

      {sent && <PushNotificationPreview notification={sent} onDismiss={() => setSent(null)} />}

      <DocumentPreviewDialog open={previewing} title={label} file={value} onClose={() => setPreviewing(false)} />
      <RejectionDialog
        open={rejecting}
        documentLabel={label}
        pending={pending}
        error={rejectError}
        onCancel={() => {
          setRejecting(false);
          setRejectError(null);
        }}
        onConfirm={reject}
      />
    </div>
  );
}
