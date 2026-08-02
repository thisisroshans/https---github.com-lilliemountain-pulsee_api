import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../src/shared/errors/index.js';
import { buildPage, decodeCursor, encodeCursor } from '../../src/shared/http/pagination.js';

interface Row {
  id: string;
  createdAt: string;
}

const toCursor = (row: Row) => ({ at: row.createdAt, id: row.id });
const rows = (n: number): Row[] =>
  Array.from({ length: n }, (_v, i) => ({
    id: `id-${String(i)}`,
    createdAt: `2026-08-0${String(i + 1)}T00:00:00.000Z`,
  }));

describe('cursor encoding', () => {
  it('round-trips a cursor', () => {
    const cursor = { at: '2026-08-02T10:00:00.000Z', id: 'abc' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('rejects a cursor that is not valid base64url JSON', () => {
    expect(() => decodeCursor('!!!not-a-cursor!!!')).toThrow(ValidationError);
  });

  it('rejects a cursor missing required fields', () => {
    const bad = Buffer.from(JSON.stringify({ at: 'x' })).toString('base64url');
    expect(() => decodeCursor(bad)).toThrow(ValidationError);
  });
});

describe('buildPage', () => {
  it('reports more pages and trims the sentinel row', () => {
    const page = buildPage(rows(4), 3, toCursor);
    expect(page.items).toHaveLength(3);
    expect(page.pagination.hasMore).toBe(true);
    const { nextCursor } = page.pagination;
    expect(nextCursor).not.toBeNull();
    expect(nextCursor === null ? null : decodeCursor(nextCursor).id).toBe('id-2');
  });

  it('reports the last page when no sentinel row came back', () => {
    const page = buildPage(rows(2), 3, toCursor);
    expect(page.items).toHaveLength(2);
    expect(page.pagination.hasMore).toBe(false);
    expect(page.pagination.nextCursor).toBeNull();
  });

  it('handles an empty result set', () => {
    const page = buildPage([], 3, toCursor);
    expect(page.items).toEqual([]);
    expect(page.pagination).toEqual({ nextCursor: null, hasMore: false, limit: 3 });
  });
});
