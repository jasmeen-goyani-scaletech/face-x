'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Button from './Button';
import Chip, { reviewChip } from './Chip';
import DocumentIconBox from './DocumentIconBox';
import { FieldError } from './FormFieldWrapper';
import IconButton from './IconButton';
import { EyeIcon, RefreshIcon, TrashIcon, UploadIcon } from './Icons';
import InfoTooltip from './InfoTooltip';
import DocumentPreviewDialog from '@/components/admin/DocumentPreviewDialog';
import { getDownloadUrl } from '@/lib/api/documents';
import { describeError } from '@/lib/api/errors';
import { DOCUMENT_ACCEPT, formatFileSize, readDocumentFile, validateDocumentFile } from '@/lib/playerDocuments';
import type { UploadedFile } from '@/lib/types';

/**
 * The one upload row used by player documents, coach certificates and staff onboarding:
 *
 *   [type icon]  Title *  (i)  ········  [status badge]  [action button(s)]
 *
 * The badge is the only statement of upload state (no "No file uploaded yet" subtitle). The icon square shows the
 * document's type until a file exists, then a thumbnail or a green checked file. The action is "Upload" until a file
 * exists, then three icon buttons — view, replace, remove — each with a hover tooltip and an accessible name. The whole row is also a drag-and-drop target.
 * `error` is a message from the parent (e.g. "required"); file problems are reported here.
 */
export default function DocumentUploadRow({
  documentId,
  label,
  hint,
  required,
  value,
  onChange,
  error,
  upload,
  allowRemove = true,
  canReplace = true
}: {
  /** e.g. `birthCertificate` — picks the type icon. */
  documentId: string;
  label: string;
  /** Requirement details, shown in an (i) popover next to the title. */
  hint?: string;
  required: boolean;
  value: UploadedFile;
  onChange: (next: UploadedFile) => void;
  error?: string | null;
  /**
   * Sends the file somewhere real (e.g. the API) instead of reading it into the browser. It reports progress 0-100 and
   * throws an Error with a message fit to show. When given, `onChange` is not used for new files.
   */
  upload?: (file: File, onProgress: (percent: number) => void) => Promise<void>;
  /** false when a stored file can only be replaced, not deleted (the API has no delete). */
  allowRemove?: boolean;
  /** false once the file is in review or approved: no replace button, and dropping a file does nothing. */
  canReplace?: boolean;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [remoteError, setRemoteError] = useState<string | null>(null);

  // A file held on the server but not in this browser (after a reload, or on another device): ask for a fresh signed link each time
  // the preview opens (links are short-lived). A file picked in this session is shown from the browser's own copy, no request.
  const remote = value.serverId && !value.dataUrl;
  useEffect(() => {
    if (!previewing || !remote || !value.serverId) return;
    let cancelled = false;
    setRemoteUrl(null);
    setRemoteError(null);
    getDownloadUrl(value.serverId, { inline: true })
      .then((r) => !cancelled && setRemoteUrl(r.url))
      .catch((e) => !cancelled && setRemoteError(describeError(e, 'We couldn’t open this file. Please try again.')));
    return () => {
      cancelled = true;
    };
  }, [previewing, remote, value.serverId]);

  const uploading = progress !== null;
  const rejected = value.review === 'rejected';
  const shownError = fileError ?? (value.uploaded ? null : error) ?? null;

  async function accept(files: FileList | null) {
    setFileError(null);
    if (!canReplace) return;
    if (!files || files.length === 0) return;
    if (files.length > 1) return setFileError('Drop one file at a time for each document.');
    const file = files[0];
    const problem = validateDocumentFile(file);
    if (problem) return setFileError(problem);
    setProgress(0);
    try {
      if (upload) await upload(file, setProgress);
      else onChange(await readDocumentFile(file, setProgress));
    } catch (e) {
      setFileError(e instanceof Error ? e.message : 'We couldn’t upload that file. Please try again.');
    } finally {
      setProgress(null);
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        accept(e.dataTransfer.files);
      }}
      className={[
        'border-b border-line px-2 py-3 transition-colors last:border-b-0',
        dragging ? 'bg-primary-light' : shownError || rejected ? 'bg-danger-tint' : ''
      ].join(' ')}
    >
      {/* Phones: title row, then badge + actions row. From 480px: one row. */}
      <div className="flex flex-col gap-2 xs:flex-row xs:items-center xs:gap-3">
        {/* Type icon + title */}
        <div className="flex min-w-0 items-center gap-3 xs:flex-1">
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
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold leading-snug text-ink">
                {label}
                {required ? (
                  <span aria-hidden="true" className="ml-0.5 text-field-error">
                    *
                  </span>
                ) : (
                  <span className="ml-1.5 text-[11.5px] font-medium text-ink-faint">(optional)</span>
                )}
              </span>
              {hint && <InfoTooltip label={label}>{hint}</InfoTooltip>}
            </div>
            {/* The file name is only shown once there is one — it is detail, not a second status. */}
            {value.uploaded && !uploading && (
              <div className="truncate text-xs text-ink-faint">
                {value.fileName}
                {value.size !== undefined ? ` · ${formatFileSize(value.size)}` : ''}
              </div>
            )}
          </div>
        </div>

        {/* Status badge + actions */}
        <div className="flex items-center justify-between gap-2 xs:justify-end">
          {uploading ? (
            <span role="status">
              <Chip kind="info">Uploading {progress}%</Chip>
            </span>
          ) : (
            reviewChip(value.uploaded ? value.review === 'not_submitted' ? 'uploaded' : value.review : 'missing')
          )}

          {value.uploaded ? (
            <div role="group" aria-label={`${label} actions`} className="flex items-center gap-1">
              <IconButton label={`Preview ${label}`} tooltip="View" onClick={() => setPreviewing(true)} disabled={uploading}>
                <EyeIcon size={16} />
              </IconButton>
              {canReplace && (
                <IconButton label={`Replace ${label}`} tooltip="Replace" onClick={() => inputRef.current?.click()} disabled={uploading}>
                  <RefreshIcon size={16} />
                </IconButton>
              )}
              {allowRemove && (
                <IconButton
                  label={`Remove ${label}`}
                  tooltip="Remove"
                  tone="danger"
                  disabled={uploading}
                  onClick={() => {
                    setFileError(null);
                    onChange({ uploaded: false, fileName: '', review: 'not_submitted' });
                  }}
                >
                  <TrashIcon size={16} />
                </IconButton>
              )}
            </div>
          ) : (
            <Button
              id={documentId}
              variant="primary"
              size="sm"
              className="!min-h-[44px] sm:!min-h-[34px]"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
            >
              <UploadIcon size={14} /> Upload
            </Button>
          )}
        </div>
      </div>

      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept={DOCUMENT_ACCEPT}
        aria-label={`${value.uploaded ? 'Replace' : 'Upload'} ${label}`}
        className="sr-only"
        onChange={(e) => {
          accept(e.target.files);
          e.target.value = '';
        }}
      />

      {rejected && !shownError && (
        <FieldError className="mt-1.5">Not accepted{value.reason ? `: ${value.reason}` : ''} — please upload a replacement.</FieldError>
      )}
      {shownError && <FieldError className="mt-1.5">{shownError}</FieldError>}

      <DocumentPreviewDialog
        open={previewing}
        title={label}
        file={value}
        onClose={() => setPreviewing(false)}
        remote={remote ? { url: remoteUrl, mimeType: value.mimeType ?? '', error: remoteError } : undefined}
      />
    </div>
  );
}
