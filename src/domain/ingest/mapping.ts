import { z } from 'zod';
import { EntityType } from '@prisma/client';

/**
 * Per-batch mapping configuration. Stored on the SourceConnection and used at
 * two points:
 *  - ingestion (UNI-130): decide which sheet is which entity type;
 *  - normalization (UNI-131): map source columns -> canonical fields.
 *
 * The `columns` map (canonicalField -> sourceHeader) is captured now but only
 * applied later, at the normalize stage.
 */
export const EntityTypeName = z.nativeEnum(EntityType);
export type EntityTypeName = z.infer<typeof EntityTypeName>;

export const SheetMappingSchema = z.object({
  entityType: EntityTypeName,
  /** XLSX sheet-name selector. Ignored for CSV (single sheet). */
  sheet: z.string().optional(),
  /** canonicalField -> sourceHeader. Applied at the normalize stage. */
  columns: z.record(z.string()).default({}),
});
export type SheetMapping = z.infer<typeof SheetMappingSchema>;

export const MappingConfigSchema = z.object({
  sheets: z.array(SheetMappingSchema).default([]),
});
export type MappingConfig = z.infer<typeof MappingConfigSchema>;

/** Sheet-name conventions -> entity type, used when mapping is absent. */
const SHEET_NAME_TO_ENTITY: Record<string, EntityType> = {
  product: EntityType.PRODUCT,
  products: EntityType.PRODUCT,
  booking: EntityType.BOOKING,
  bookings: EntityType.BOOKING,
  traveler: EntityType.TRAVELER,
  travelers: EntityType.TRAVELER,
  traveller: EntityType.TRAVELER,
  travellers: EntityType.TRAVELER,
  guide: EntityType.GUIDE,
  guides: EntityType.GUIDE,
  qualification: EntityType.QUALIFICATION,
  qualifications: EntityType.QUALIFICATION,
  'staffing rule': EntityType.STAFFING_RULE,
  'staffing rules': EntityType.STAFFING_RULE,
  staffing_rule: EntityType.STAFFING_RULE,
  staffing_rules: EntityType.STAFFING_RULE,
  staffingrules: EntityType.STAFFING_RULE,
};

/**
 * Resolve the entity type for a parsed sheet. Precedence:
 *  1. explicit mapping entry whose `sheet` matches the sheet name;
 *  2. for a single-sheet source (CSV), a mapping entry with no `sheet`;
 *  3. sheet-name convention.
 * Returns undefined if it cannot be determined (sheet is then skipped).
 */
export function resolveEntityType(
  sheet: { name?: string },
  mapping: MappingConfig,
  isSingleSheet: boolean,
): { entityType: EntityType; columns: Record<string, string> } | undefined {
  const byName = sheet.name
    ? mapping.sheets.find((s) => s.sheet && s.sheet.toLowerCase() === sheet.name!.toLowerCase())
    : undefined;
  if (byName) return { entityType: byName.entityType, columns: byName.columns };

  if (isSingleSheet) {
    const unscoped = mapping.sheets.find((s) => !s.sheet);
    if (unscoped) return { entityType: unscoped.entityType, columns: unscoped.columns };
  }

  const detected = sheet.name ? SHEET_NAME_TO_ENTITY[sheet.name.trim().toLowerCase()] : undefined;
  if (detected) return { entityType: detected, columns: {} };

  return undefined;
}
