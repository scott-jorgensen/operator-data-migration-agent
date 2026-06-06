import type { EntityType } from '@prisma/client';

/** One sheet's headers + a few sample rows, with an optional target entity type. */
export interface SheetSample {
  name?: string;
  headers: string[];
  sampleRows: Array<Record<string, unknown>>;
  entityType?: EntityType;
}

/** A suggested mapping for one sheet, with confidence and a review flag. */
export interface SuggestedSheetMapping {
  sheet?: string;
  entityType: EntityType;
  /** canonicalField -> sourceHeader */
  columns: Record<string, string>;
  /** canonicalField -> confidence in [0, 1] */
  fieldConfidence: Record<string, number>;
  needsReview: boolean;
}

export interface MappingSuggestion {
  sheets: SuggestedSheetMapping[];
  /** Which implementation produced the suggestion. */
  source: 'ai' | 'alias';
}

/**
 * Suggests a column mapping for uploaded spreadsheet data. The operator reviews
 * and confirms the result before it is used at ingest. Backed by an LLM when
 * configured, with a deterministic alias-based fallback otherwise.
 */
export interface ColumnMapper {
  suggest(sheets: SheetSample[]): Promise<MappingSuggestion>;
}
