/** A page of a list the API pages: the rows, and how many rows there are across every page. */
export interface PageLike<T> {
  items: T[];
  total: number;
}

/**
 * Reads EVERY page of a paged list. The first page says how many rows there are, so the rest are asked for together, not one
 * after another. A row that shows up twice (the list changed while it was being read) is kept once, in the order first seen.
 * For the few lists a screen needs whole (an event picker), not for lists a person pages through.
 */
export async function loadAllPages<T>(
  fetchPage: (page: number) => Promise<PageLike<T>>,
  pageSize: number,
  /** What makes a row the same row (default: its `id`). */
  keyOf: (row: T) => string = (row) => (row as { id: string }).id
): Promise<T[]> {
  const first = await fetchPage(1);
  const more = Math.max(0, Math.ceil(first.total / pageSize) - 1);
  const rest = await Promise.all(Array.from({ length: more }, (_, i) => fetchPage(i + 2)));
  const seen = new Set<string>();
  const all: T[] = [];
  for (const page of [first, ...rest]) {
    for (const item of page.items) {
      const key = keyOf(item);
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(item);
    }
  }
  return all;
}
