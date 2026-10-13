'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

export const PAGE_SIZES = [10, 25, 50, 100] as const;
const PAGE_SIZE_KEY = 'facex-admin-page-size';

/** The rows-per-page the admin last chose (shared by every admin list), or the default. Read when a list first renders. */
function savedPageSize(): number {
  try {
    const saved = Number(window.localStorage.getItem(PAGE_SIZE_KEY));
    if ((PAGE_SIZES as readonly number[]).includes(saved)) return saved;
  } catch {
    // storage blocked, or no window yet: keep the default
  }
  return PAGE_SIZES[0];
}

/**
 * The page and rows-per-page of a list the SERVER pages: the caller asks the API for `page` and `pageSize` and shows what
 * comes back. Changing the size goes back to page 1 in the same update, so it is one request, not two.
 */
export function useServerPaging() {
  const [paging, setPaging] = useState(() => ({ page: 1, pageSize: savedPageSize() }));
  const setPage = useCallback((page: number) => setPaging((p) => ({ ...p, page })), []);
  const setPageSize = useCallback((pageSize: number) => {
    setPaging({ page: 1, pageSize });
    try {
      window.localStorage.setItem(PAGE_SIZE_KEY, String(pageSize));
    } catch {
      // ignore
    }
  }, []);
  return { page: paging.page, pageSize: paging.pageSize, setPage, setPageSize };
}

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
