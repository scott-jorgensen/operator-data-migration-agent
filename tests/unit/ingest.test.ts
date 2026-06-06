import { describe, expect, it } from 'vitest';
import { EntityType } from '@prisma/client';
import { MappingConfigSchema, resolveEntityType } from '../../src/domain/ingest/mapping.js';
import { CsvConnector } from '../../src/infra/connectors/csv.connector.js';

describe('resolveEntityType', () => {
  const empty = MappingConfigSchema.parse({});

  it('detects entity type from a sheet-name convention', () => {
    expect(resolveEntityType({ name: 'Products' }, empty, false)?.entityType).toBe(EntityType.PRODUCT);
    expect(resolveEntityType({ name: 'travellers' }, empty, false)?.entityType).toBe(EntityType.TRAVELER);
    expect(resolveEntityType({ name: 'Staffing Rules' }, empty, false)?.entityType).toBe(
      EntityType.STAFFING_RULE,
    );
  });

  it('returns undefined for an unrecognized sheet with no mapping', () => {
    expect(resolveEntityType({ name: 'random' }, empty, false)).toBeUndefined();
    expect(resolveEntityType({ name: undefined }, empty, true)).toBeUndefined();
  });

  it('prefers an explicit sheet-scoped mapping over name detection', () => {
    const mapping = MappingConfigSchema.parse({
      sheets: [{ entityType: 'BOOKING', sheet: 'Products', columns: { reference: 'sku' } }],
    });
    const resolved = resolveEntityType({ name: 'Products' }, mapping, false);
    expect(resolved?.entityType).toBe(EntityType.BOOKING);
    expect(resolved?.columns).toEqual({ reference: 'sku' });
  });

  it('applies an unscoped mapping entry only for a single-sheet source', () => {
    const mapping = MappingConfigSchema.parse({ sheets: [{ entityType: 'GUIDE' }] });
    expect(resolveEntityType({ name: undefined }, mapping, true)?.entityType).toBe(EntityType.GUIDE);
    expect(resolveEntityType({ name: undefined }, mapping, false)).toBeUndefined();
  });
});

describe('CsvConnector', () => {
  it('parses headers and rows into a single sheet', async () => {
    const csv = Buffer.from('sku,name\nA1,Alpha\nB2,Beta\n');
    const wb = await new CsvConnector().parse(csv);
    expect(wb.sheets).toHaveLength(1);
    expect(wb.sheets[0]?.headers).toEqual(['sku', 'name']);
    expect(wb.sheets[0]?.rows).toEqual([
      { sku: 'A1', name: 'Alpha' },
      { sku: 'B2', name: 'Beta' },
    ]);
  });
});
