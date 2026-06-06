import { z } from 'zod';
import type { SourceKind } from '@prisma/client';

export const CreateSessionSchema = z.object({
  name: z.string().min(1),
  operatorRef: z.string().min(1),
  createdBy: z.string().optional(),
  notes: z.string().optional(),
});
export type CreateSessionBody = z.infer<typeof CreateSessionSchema>;

/** Map an uploaded filename's extension to a SourceKind. */
export function kindFromFilename(filename: string): SourceKind | undefined {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv')) return 'CSV';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) return 'XLSX';
  return undefined;
}
