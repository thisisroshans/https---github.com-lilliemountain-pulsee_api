import { ValidationError } from '../errors/app-error.js';
import type { PaginationMeta } from './envelope.js';

/**
 * Cursor pagination. The cursor is an opaque base64url token so clients cannot
 * build one by hand and we stay free to change what it encodes.
 */

export interface Cursor {
  /** Sort key of the last item on the previous page (ISO timestamp). */
  at: string;
  /** Tie-breaker id, so equal timestamps still paginate deterministically. */
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): Cursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new ValidationError('Malformed pagination cursor.', [
      { path: 'cursor', message: 'Cursor is not a valid pagination token.' },
    ]);
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Cursor).at !== 'string' ||
    typeof (parsed as Cursor).id !== 'string'
  ) {
    throw new ValidationError('Malformed pagination cursor.', [
      { path: 'cursor', message: 'Cursor is not a valid pagination token.' },
    ]);
  }

  return parsed as Cursor;
}

/**
 * Given `limit + 1` rows fetched from the repository, trim to `limit` and build
 * the pagination meta. Fetching one extra row is how we know `hasMore` without
 * a second COUNT query.
 */
export function buildPage<T>(
  rows: T[],
  limit: number,
  toCursor: (row: T) => Cursor,
): { items: T[]; pagination: PaginationMeta } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);

  return {
    items,
    pagination: {
      nextCursor: hasMore && last !== undefined ? encodeCursor(toCursor(last)) : null,
      hasMore,
      limit,
    },
  };
}
