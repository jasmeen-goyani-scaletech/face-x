import type { ReactNode } from 'react';
import { DOCUMENT_TABLE_COLUMNS, documentStatus } from './DocumentReviewRow';
import type { UploadedFile } from '@/lib/types';

/**
 * Document review table: a one-line summary, then a four-column header (Document, Status, File, Actions) and one
 * compact row per document (`DocumentReviewRow`). On narrower screens the header disappears and each row stacks into a
 * short list item. Shared by the player, coach and staff views.
 *
 * No `overflow-hidden` on the frame: the rows round their own end corners, which leaves room for the action tooltips
 * to appear above the first row instead of being clipped.
 */
export default function DocumentReviewTable({ files, children }: { files: UploadedFile[]; children: ReactNode }) {
  const statuses = files.map(documentStatus);
  const count = (s: string) => statuses.filter((x) => x === s).length;
  const parts = [
    `${files.filter((f) => f.uploaded).length} of ${files.length} uploaded`,
    count('PENDING_REVIEW') && `${count('PENDING_REVIEW')} pending review`,
    count('APPROVED') && `${count('APPROVED')} approved`,
    count('REJECTED') && `${count('REJECTED')} rejected`
  ].filter(Boolean);

  return (
    <div>
      <p className="mb-2.5 mt-0 text-[12.5px] font-semibold text-ink-soft">{parts.join(' · ')}</p>
      <div role="table" aria-label="Documents" className="rounded-m border border-line">
        <div
          role="row"
          className={[
            'hidden rounded-t-m border-b border-l-4 border-line border-l-transparent bg-surface-2 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-ink-faint xl:grid xl:items-center xl:gap-4',
            DOCUMENT_TABLE_COLUMNS
          ].join(' ')}
        >
          <span role="columnheader">Document</span>
          <span role="columnheader">Status</span>
          <span role="columnheader">File</span>
          <span role="columnheader" className="text-right">
            Actions
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
