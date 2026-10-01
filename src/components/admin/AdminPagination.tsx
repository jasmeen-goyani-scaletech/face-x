'use client';

import { useEffect, useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/ui/Icons';
import { PAGE_SIZES } from '@/lib/usePagination';

const btn =
  'inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-s border border-line-strong bg-surface px-2.5 text-[13px] font-semibold text-ink-soft ' +
  'transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ' +
  'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface disabled:hover:text-ink-soft';

/**
 * Pagination bar for admin lists: "Showing 1 to 10 of 248 entries", rows-per-page, First / Prev / Next / Last and a
 * jump-to-page box. Pure presentation; pair it with `usePagination`. Renders nothing while everything fits on one page
 * at the smallest page size.
 */
export default function AdminPagination({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizes = PAGE_SIZES,
  noun = 'entries',
  className = ''
}: {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSizes?: readonly number[];
  noun?: string;
  className?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  const [jump, setJump] = useState(String(page));
  useEffect(() => setJump(String(page)), [page]);

  if (total <= Math.min(...pageSizes)) return null;

  function commitJump() {
    const n = Math.trunc(Number(jump));
    if (Number.isFinite(n) && jump.trim() !== '') onPageChange(Math.min(totalPages, Math.max(1, n)));
    else setJump(String(page));
  }

  const atStart = page <= 1;
  const atEnd = page >= totalPages;

  return (
    <nav aria-label="Pagination" className={['mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3', className].join(' ')}>
      <p className="m-0 text-[12.5px] text-ink-soft" aria-live="polite">
        Showing <strong className="text-ink">{from}</strong> to <strong className="text-ink">{to}</strong> of{' '}
        <strong className="text-ink">{total}</strong> {noun}
      </p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-[12.5px] text-ink-soft">
          Rows per page
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="h-9 rounded-s border border-line-strong bg-surface px-2 text-[13px] font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {pageSizes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1.5">
          <button type="button" className={btn} onClick={() => onPageChange(1)} disabled={atStart} aria-label="First page">
            «
          </button>
          <button type="button" className={btn} onClick={() => onPageChange(page - 1)} disabled={atStart} aria-label="Previous page">
            <ChevronLeftIcon size={15} />
            <span className="hidden sm:inline">Prev</span>
          </button>
          <span className="px-1 text-[12.5px] text-ink-soft">
            Page {page} of {totalPages}
          </span>
          <button type="button" className={btn} onClick={() => onPageChange(page + 1)} disabled={atEnd} aria-label="Next page">
            <span className="hidden sm:inline">Next</span>
            <ChevronRightIcon size={15} />
          </button>
          <button type="button" className={btn} onClick={() => onPageChange(totalPages)} disabled={atEnd} aria-label="Last page">
            »
          </button>
        </div>

        <label className="flex items-center gap-2 text-[12.5px] text-ink-soft">
          Go to
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={totalPages}
            value={jump}
            onChange={(e) => setJump(e.target.value)}
            onBlur={commitJump}
            onKeyDown={(e) => e.key === 'Enter' && commitJump()}
            aria-label={`Jump to page, 1 to ${totalPages}`}
            className="h-9 w-16 rounded-s border border-line-strong bg-surface px-2 text-center text-[13px] font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </label>
      </div>
    </nav>
  );
}
