import { z } from 'zod';

/** Standard pagination query: `?limit=&cursor=`. */
export const PageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});
export type PageQuery = z.infer<typeof PageQuerySchema>;

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

/** Prisma args fragment for cursor pagination — fetch `limit + 1` to detect more. */
export function pageArgs(page: PageQuery) {
  return {
    take: page.limit + 1,
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
  };
}

/** Split an over-fetched row set into a page + nextCursor. */
export function toPage<T extends { id: string }>(rows: T[], page: PageQuery): Page<T> {
  const hasMore = rows.length > page.limit;
  const data = hasMore ? rows.slice(0, page.limit) : rows;
  const last = data[data.length - 1];
  return { data, nextCursor: hasMore && last ? last.id : null };
}
