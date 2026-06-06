import { parse } from 'csv-parse/sync';
import type { ParsedWorkbook, SourceConnector } from '../../ports/source-connector.port.js';

/**
 * CSV connector. A CSV is a single unnamed sheet. The first row is the header;
 * rows are returned as header -> string value maps.
 */
export class CsvConnector implements SourceConnector {
  readonly kind = 'CSV' as const;

  async parse(input: Buffer): Promise<ParsedWorkbook> {
    const records = parse(input, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: true,
    }) as Array<Record<string, unknown>>;

    const first = records[0];
    const headers = first ? Object.keys(first) : [];

    return {
      sheets: [{ index: 0, headers, rows: records, rowErrors: [] }],
    };
  }
}
