import { EntityType } from '@prisma/client';
import { FIELD_ALIASES } from '../../domain/canonical/schemas.js';
import { detectEntityTypeFromName } from '../../domain/ingest/mapping.js';
import type {
  ColumnMapper,
  MappingSuggestion,
  SheetSample,
  SuggestedSheetMapping,
} from '../../ports/column-mapper.port.js';

/** Normalize a header for loose matching: lowercase, alphanumerics only. */
function normKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Deterministic ColumnMapper used when no LLM is configured. Resolves the
 * entity type from the provided hint or the sheet-name convention, then matches
 * each canonical field to a source header via the field-alias table.
 */
export class AliasColumnMapper implements ColumnMapper {
  async suggest(sheets: SheetSample[]): Promise<MappingSuggestion> {
    return { source: 'alias', sheets: sheets.map((s) => this.suggestSheet(s)) };
  }

  private suggestSheet(sheet: SheetSample): SuggestedSheetMapping {
    const entityType = sheet.entityType ?? detectEntityTypeFromName(sheet.name);

    if (!entityType) {
      return { sheet: sheet.name, entityType: EntityType.PRODUCT, columns: {}, fieldConfidence: {}, needsReview: true };
    }

    const byNormHeader = new Map<string, string>();
    for (const header of sheet.headers) byNormHeader.set(normKey(header), header);

    const columns: Record<string, string> = {};
    const fieldConfidence: Record<string, number> = {};
    const aliases = FIELD_ALIASES[entityType];

    for (const field of Object.keys(aliases)) {
      // Exact field-name match is the most confident; alias match slightly less.
      const direct = byNormHeader.get(normKey(field));
      if (direct) {
        columns[field] = direct;
        fieldConfidence[field] = 0.95;
        continue;
      }
      for (const alias of aliases[field] ?? []) {
        const hit = byNormHeader.get(normKey(alias));
        if (hit) {
          columns[field] = hit;
          fieldConfidence[field] = 0.8;
          break;
        }
      }
    }

    return {
      sheet: sheet.name,
      entityType,
      columns,
      fieldConfidence,
      // Nothing matched, or the entity type was only inferred — worth a look.
      needsReview: Object.keys(columns).length === 0 || !sheet.entityType,
    };
  }
}
