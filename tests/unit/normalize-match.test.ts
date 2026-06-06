import { describe, expect, it } from 'vitest';
import { EntityType } from '@prisma/client';
import { buildCanonical } from '../../src/domain/canonical/normalize.js';
import { findIntraBatchDuplicates, similarity, type MatchableRecord } from '../../src/domain/match/dedupe.js';

describe('buildCanonical', () => {
  it('maps header aliases and coerces types for a product', () => {
    const { data, keys, validationErrors } = buildCanonical(
      EntityType.PRODUCT,
      { 'Product Name': 'Kilimanjaro 7-Day', SKU: 'TZ-KILI-7D', Price: '2,450', Currency: 'USD' },
      {},
    );
    expect(validationErrors).toEqual([]);
    expect(data).toMatchObject({ name: 'Kilimanjaro 7-Day', sku: 'TZ-KILI-7D', price: 2450, currency: 'USD' });
    expect(keys.keyCode).toBe('tz-kili-7d');
    expect(keys.dedupeKey).toBe('tz-kili-7d');
  });

  it('honors an explicit column mapping over aliases', () => {
    const { data } = buildCanonical(
      EntityType.BOOKING,
      { Ref: 'BK-1', Departs: '2026-07-01' },
      { reference: 'Ref', startDate: 'Departs' },
    );
    expect(data.reference).toBe('BK-1');
    expect(String(data.startDate)).toContain('2026-07-01');
  });

  it('flags validation errors but still returns best-effort data + keys', () => {
    const { data, keys, validationErrors } = buildCanonical(
      EntityType.TRAVELER,
      { Email: 'not-an-email', Name: 'Ana Vidal' },
      {},
    );
    expect(validationErrors.join(' ')).toMatch(/email/i);
    expect(data.fullName).toBe('Ana Vidal');
    expect(keys.keyName).toBe('ana vidal');
  });
});

describe('findIntraBatchDuplicates', () => {
  const rec = (id: string, over: Partial<MatchableRecord>): MatchableRecord => ({
    id,
    entityType: EntityType.TRAVELER,
    keyEmail: null,
    keyCode: null,
    keyName: null,
    ...over,
  });

  it('flags an exact email duplicate against the earlier row', () => {
    const findings = findIntraBatchDuplicates([
      rec('a', { keyEmail: 'ana@example.com', keyName: 'ana vidal' }),
      rec('b', { keyEmail: 'ana@example.com', keyName: 'ana v' }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ recordId: 'b', peerRecordId: 'a', strategy: 'email_exact', reason: 'DUPLICATE', score: 1 });
  });

  it('flags a fuzzy name match as low-confidence', () => {
    const findings = findIntraBatchDuplicates([
      rec('a', { keyName: 'ana vidal' }),
      rec('b', { keyName: 'ana vidall' }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.strategy).toBe('name_fuzzy');
    expect(findings[0]?.reason).toBe('LOW_CONFIDENCE');
    expect(findings[0]?.explanation).toMatch(/% similar/);
  });

  it('does not flag distinct records', () => {
    const findings = findIntraBatchDuplicates([
      rec('a', { keyEmail: 'ana@example.com', keyName: 'ana vidal' }),
      rec('b', { keyEmail: 'ben@example.com', keyName: 'ben okoro' }),
    ]);
    expect(findings).toEqual([]);
  });

  it('similarity is 1 for identical and lower for edits', () => {
    expect(similarity('abc', 'abc')).toBe(1);
    expect(similarity('abc', 'abd')).toBeCloseTo(2 / 3, 5);
  });
});
