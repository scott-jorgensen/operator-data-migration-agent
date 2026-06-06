import { describe, expect, it } from 'vitest';
import { PageQuerySchema, pageArgs, toPage } from '../../src/api/pagination.js';
import { errorBody } from '../../src/api/errors.js';

describe('pagination', () => {
  it('defaults limit and clamps to bounds', () => {
    expect(PageQuerySchema.parse({}).limit).toBe(50);
    expect(PageQuerySchema.parse({ limit: '10' }).limit).toBe(10);
    expect(PageQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(PageQuerySchema.safeParse({ limit: '999' }).success).toBe(false);
  });

  it('over-fetches by one and exposes the cursor', () => {
    expect(pageArgs({ limit: 50 })).toMatchObject({ take: 51 });
    expect(pageArgs({ limit: 50, cursor: 'abc' })).toMatchObject({
      take: 51,
      cursor: { id: 'abc' },
      skip: 1,
    });
  });

  it('splits an over-fetched set into a page + nextCursor', () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ id: `id${i}` }));
    const page = toPage(rows, { limit: 2 });
    expect(page.data.map((r) => r.id)).toEqual(['id0', 'id1']);
    expect(page.nextCursor).toBe('id1');
  });

  it('returns a null cursor on the last page', () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    expect(toPage(rows, { limit: 5 }).nextCursor).toBeNull();
  });
});

describe('errorBody', () => {
  it('builds a consistent envelope, omitting empty details', () => {
    expect(errorBody('not_found', 'gone')).toEqual({ error: { code: 'not_found', message: 'gone' } });
    expect(errorBody('bad', 'x', { a: 1 })).toEqual({ error: { code: 'bad', message: 'x', details: { a: 1 } } });
  });
});
