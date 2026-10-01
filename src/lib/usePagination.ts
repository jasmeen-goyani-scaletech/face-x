'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

export const PAGE_SIZES = [10, 25, 50, 100] as const;
const PAGE_SIZE_KEY = 'facex-admin-page-size';

/**
 * Client-side pagination over an already searched/filtered list. Search, filter and sort state stay with the caller, so
 * paging never touches them; pass `resetKey` (e.g. a string of the active query + filters) to jump back to page 1 when they
 * change. Rows-per-page is remembered across admin lists.
 */
export function usePagination<T>(items: T[], resetKey = '') {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState<number>(PAGE_SIZES[0]);

  // Read after mount so the server and first client render agree.
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(PAGE_SIZE_KEY));
      if ((PAGE_SIZES as readonly number[]).includes(saved)) setPageSizeState(saved);
    } catch {
      // storage blocked: keep the default
    }
  }, []);

  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, totalPages);

  const pageItems = useMemo(
    () => items.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [items, currentPage, pageSize]
  );

  const setPageSize = useCallback((size: number) => {
    setPageSizeState(size);
    setPage(1);
    try {
      window.localStorage.setItem(PAGE_SIZE_KEY, String(size));
    } catch {
      // ignore
    }
  }, []);

  return { pageItems, page: currentPage, pageSize, total: items.length, totalPages, setPage, setPageSize };
}
