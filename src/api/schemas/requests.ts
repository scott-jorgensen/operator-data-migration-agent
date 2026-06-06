import { z } from 'zod';
import { EntityType, type SourceKind, ReviewReason, ReviewResolution, ReviewStatus } from '@prisma/client';

export const CreateSessionSchema = z.object({
  name: z.string().min(1),
  operatorRef: z.string().min(1),
  createdBy: z.string().optional(),
  notes: z.string().optional(),
});
export type CreateSessionBody = z.infer<typeof CreateSessionSchema>;

export const ResolveReviewSchema = z.object({
  resolution: z.nativeEnum(ReviewResolution),
  resolvedBy: z.string().optional(),
  resolutionData: z.record(z.unknown()).optional(),
});
export type ResolveReviewBody = z.infer<typeof ResolveReviewSchema>;

export const ReviewListQuerySchema = z.object({
  status: z.nativeEnum(ReviewStatus).optional(),
  reason: z.nativeEnum(ReviewReason).optional(),
  entityType: z.nativeEnum(EntityType).optional(),
});
export type ReviewListQuery = z.infer<typeof ReviewListQuerySchema>;

/** Map an uploaded filename's extension to a SourceKind. */
export function kindFromFilename(filename: string): SourceKind | undefined {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv')) return 'CSV';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) return 'XLSX';
  return undefined;
}
