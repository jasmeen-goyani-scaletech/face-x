'use client';

import { useId } from 'react';
import Button from '@/components/ui/Button';
import Dialog from '@/components/ui/Dialog';
import type { UploadedFile } from '@/lib/types';

/** Full-size, in-page viewer for an uploaded photo or file — no download needed. */
export default function DocumentPreviewDialog({
  open,
  title,
  file,
  onClose,
  remote
}: {
  open: boolean;
  title: string;
  file: UploadedFile;
  onClose: () => void;
  /** A file held on the server: its short-lived signed link (null while it is being fetched) and its type. */
  remote?: { url: string | null; mimeType: string; error?: string | null };
}) {
  const titleId = useId();
  const url = remote ? (remote.url ?? '') : (file.dataUrl ?? '');
  const isImage = remote ? !!remote.url && remote.mimeType.startsWith('image/') : url.startsWith('data:image');
  const isPdf = remote ? !!remote.url && remote.mimeType === 'application/pdf' : url.startsWith('data:application/pdf');

  return (
    <Dialog open={open} onClose={onClose} labelledBy={titleId} size="xl" initialFocus="button">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 id={titleId} className="text-lg text-ink truncate">
            {title}
          </h2>
          <p className="m-0 text-[12.5px] text-ink-faint truncate">{file.fileName}</p>
        </div>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>

      {isImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={title} className="mx-auto max-h-[72vh] max-w-full rounded-s object-contain" />
      )}
      {isPdf && <iframe src={url} title={title} className="h-[72vh] w-full rounded-s border border-line" />}
      {remote && !remote.url && !remote.error && <p className="rounded-s bg-surface-2 px-4 py-10 text-center text-sm text-ink-soft">Opening the file…</p>}
      {remote?.error && <p role="alert" className="rounded-s bg-danger-soft px-4 py-10 text-center text-sm font-semibold text-danger">{remote.error}</p>}
      {!isImage && !isPdf && !(remote && (!remote.url || remote.error)) && (
        <p className="rounded-s bg-surface-2 px-4 py-10 text-center text-sm text-ink-soft">
          A preview isn&rsquo;t available for this file. It was uploaded before previews were supported, or it is too large to keep in the browser.
        </p>
      )}
    </Dialog>
  );
}
