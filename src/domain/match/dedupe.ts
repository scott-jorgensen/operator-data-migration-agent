import type { EntityType } from '@prisma/client';

/** Minimal canonical view the matcher needs. */
export interface MatchableRecord {
  id: string;
  entityType: EntityType;
  keyEmail: string | null;
  keyCode: string | null;
  keyName: string | null;
}

export interface MatchFinding {
  recordId: string;
  /** The earlier record this one is considered a duplicate of / similar to. */
  peerRecordId: string;
  entityType: EntityType;
  strategy: 'email_exact' | 'code_exact' | 'name_fuzzy';
  score: number;
  reason: 'DUPLICATE' | 'LOW_CONFIDENCE';
  explanation: string;
}

export interface MatchOptions {
  /** Names at/above this similarity are flagged. */
  fuzzyThreshold: number;
  /** Fuzzy similarity at/above this counts as a duplicate, not just low-confidence. */
  duplicateThreshold: number;
}

export const DEFAULT_MATCH_OPTIONS: MatchOptions = {
  fuzzyThreshold: 0.85,
  duplicateThreshold: 0.97,
};

const ENTITY_LABEL: Record<EntityType, string> = {
  PRODUCT: 'product',
  BOOKING: 'booking',
  TRAVELER: 'traveler',
  GUIDE: 'guide',
  QUALIFICATION: 'qualification',
  STAFFING_RULE: 'staffing rule',
};

/**
 * Find intra-batch duplicates/near-duplicates. Records are processed in order,
 * so the earliest occurrence is treated as the primary and later ones point at
 * it. Exact email/code matches win; otherwise fuzzy name similarity is used.
 * External-platform matching is intentionally out of scope here (stubbed,
 * arrives with the publisher adapter).
 */
export function findIntraBatchDuplicates(
  records: MatchableRecord[],
  options: MatchOptions = DEFAULT_MATCH_OPTIONS,
): MatchFinding[] {
  const findings: MatchFinding[] = [];
  const matched = new Set<string>(); // records already explained as a duplicate

  const firstByKey = new Map<string, MatchableRecord>();
  const label = (e: EntityType) => ENTITY_LABEL[e];

  // Pass 1: exact email, then exact code.
  for (const key of ['keyEmail', 'keyCode'] as const) {
    firstByKey.clear();
    const strategy = key === 'keyEmail' ? 'email_exact' : 'code_exact';
    const fieldLabel = key === 'keyEmail' ? 'email' : 'code';
    for (const rec of records) {
      const value = rec[key];
      if (!value) continue;
      const bucketKey = `${rec.entityType}:${value}`;
      const primary = firstByKey.get(bucketKey);
      if (!primary) {
        firstByKey.set(bucketKey, rec);
        continue;
      }
      if (matched.has(rec.id)) continue;
      matched.add(rec.id);
      findings.push({
        recordId: rec.id,
        peerRecordId: primary.id,
        entityType: rec.entityType,
        strategy,
        score: 1,
        reason: 'DUPLICATE',
        explanation: `Shares ${fieldLabel} "${value}" with an earlier ${label(rec.entityType)} in this upload — likely the same record.`,
      });
    }
  }

  // Pass 2: fuzzy name among records not already matched exactly.
  const remaining = records.filter((r) => r.keyName && !matched.has(r.id));
  for (let i = 0; i < remaining.length; i++) {
    const rec = remaining[i]!;
    if (matched.has(rec.id)) continue;
    for (let j = 0; j < i; j++) {
      const prior = remaining[j]!;
      if (prior.entityType !== rec.entityType) continue;
      const score = similarity(rec.keyName!, prior.keyName!);
      if (score < options.fuzzyThreshold) continue;
      matched.add(rec.id);
      const isDuplicate = score >= options.duplicateThreshold;
      findings.push({
        recordId: rec.id,
        peerRecordId: prior.id,
        entityType: rec.entityType,
        strategy: 'name_fuzzy',
        score,
        reason: isDuplicate ? 'DUPLICATE' : 'LOW_CONFIDENCE',
        explanation: `Name "${rec.keyName}" is ~${Math.round(score * 100)}% similar to "${prior.keyName}" on another ${label(rec.entityType)} row${isDuplicate ? ' — likely a duplicate.' : ' — possible duplicate, please confirm.'}`,
      });
      break;
    }
  }

  return findings;
}

/** Levenshtein-ratio similarity in [0, 1]. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const distance = levenshtein(a, b);
  return 1 - distance / Math.max(a.length, b.length);
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prevDiag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, prevDiag + cost);
      prevDiag = tmp;
    }
  }
  return prev[b.length]!;
}
