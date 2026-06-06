import type { SourceKind } from '@prisma/client';

/** One parsed sheet/table from a source file. */
export interface ParsedSheet {
  /** Sheet name (XLSX) or undefined for a single-table CSV. */
  name?: string;
  /** 0-based sheet order index. */
  index: number;
  /** Column headers, in order. */
  headers: string[];
  /** Data rows as header -> cell value. */
  rows: Array<Record<string, unknown>>;
  /** Per-row parse problems (0-based data-row index). */
  rowErrors: Array<{ rowIndex: number; message: string }>;
}

export interface ParsedWorkbook {
  sheets: ParsedSheet[];
}

/**
 * Parses raw source bytes into a normalized workbook shape. One implementation
 * per SourceKind. Parsing only — no mapping or canonicalization here.
 */
export interface SourceConnector {
  readonly kind: SourceKind;
  parse(input: Buffer): Promise<ParsedWorkbook>;
}
