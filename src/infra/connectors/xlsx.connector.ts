import ExcelJS from 'exceljs';
import type { ParsedSheet, ParsedWorkbook, SourceConnector } from '../../ports/source-connector.port.js';

/**
 * XLSX connector (via exceljs). Each worksheet becomes a ParsedSheet; row 1 is
 * the header. Cell values are flattened to primitives (rich text -> text,
 * formula -> result, dates -> Date) so downstream stages see plain JSON.
 */
export class XlsxConnector implements SourceConnector {
  readonly kind = 'XLSX' as const;

  async parse(input: Buffer): Promise<ParsedWorkbook> {
    const wb = new ExcelJS.Workbook();
    // exceljs types pin an older Buffer shape than @types/node v20 exposes;
    // the value is a valid Buffer at runtime.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(input as any);

    const sheets: ParsedSheet[] = [];
    let index = 0;

    wb.eachSheet((ws) => {
      const headerValues = (ws.getRow(1).values as unknown[]) ?? [];
      // exceljs row.values is 1-based (index 0 is empty).
      const headers = headerValues.slice(1).map((v) => String(v ?? '').trim());

      const rows: Array<Record<string, unknown>> = [];
      for (let r = 2; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const cells = (row.values as unknown[]).slice(1);
        if (cells.every((v) => v === null || v === undefined || v === '')) continue;

        const rec: Record<string, unknown> = {};
        headers.forEach((header, i) => {
          if (!header) return;
          rec[header] = flattenCell(row.getCell(i + 1).value);
        });
        rows.push(rec);
      }

      sheets.push({
        name: ws.name,
        index: index++,
        headers: headers.filter(Boolean),
        rows,
        rowErrors: [],
      });
    });

    return { sheets };
  }
}

function flattenCell(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('text' in value && value.text != null) return value.text;
    if ('result' in value && value.result != null) return value.result;
    if ('hyperlink' in value && value.hyperlink != null) return value.hyperlink;
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((rt) => rt.text).join('');
    }
    return String(value);
  }
  return value;
}
