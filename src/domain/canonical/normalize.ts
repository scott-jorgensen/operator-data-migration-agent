import { EntityType } from '@prisma/client';
import {
  CANONICAL_SCHEMAS,
  type CanonicalData,
  DATE_FIELDS,
  EMAIL_FIELDS,
  FIELD_ALIASES,
  NUMERIC_FIELDS,
} from './schemas.js';

export interface DerivedKeys {
  dedupeKey: string | null;
  keyEmail: string | null;
  keyCode: string | null;
  keyName: string | null;
  keyDate: Date | null;
}

export interface NormalizeResult {
  data: CanonicalData;
  keys: DerivedKeys;
  validationErrors: string[];
}

/** Normalize a header/key for loose matching: lowercase, alphanumerics only. */
function normKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function coerce(field: string, value: unknown): unknown {
  if (value === null || value === undefined || value === '') return undefined;
  if (NUMERIC_FIELDS.has(field)) {
    const n = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : undefined;
  }
  if (EMAIL_FIELDS.has(field)) return String(value).trim().toLowerCase();
  if (DATE_FIELDS.has(field)) {
    const d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? String(value).trim() : d.toISOString();
  }
  return String(value).trim();
}

/**
 * Turn one extracted raw row into a validated canonical object plus the
 * promoted match keys. `columns` (canonicalField -> sourceHeader) takes
 * precedence; otherwise field aliases / direct name matches are used.
 */
export function buildCanonical(
  entityType: EntityType,
  rawData: Record<string, unknown>,
  columns: Record<string, string>,
): NormalizeResult {
  // Index raw cells by normalized header for loose lookup.
  const byNormHeader = new Map<string, unknown>();
  for (const [header, value] of Object.entries(rawData)) {
    byNormHeader.set(normKey(header), value);
  }

  const aliases = FIELD_ALIASES[entityType];
  const data: CanonicalData = {};

  for (const field of Object.keys(aliases)) {
    let raw: unknown;
    const mapped = columns[field];
    if (mapped) {
      raw = rawData[mapped] ?? byNormHeader.get(normKey(mapped));
    } else {
      for (const alias of [field, ...(aliases[field] ?? [])]) {
        const hit = byNormHeader.get(normKey(alias));
        if (hit !== undefined && hit !== null && hit !== '') {
          raw = hit;
          break;
        }
      }
    }
    const coerced = coerce(field, raw);
    if (coerced !== undefined) data[field] = coerced;
  }

  const parsed = CANONICAL_SCHEMAS[entityType].safeParse(data);
  const validationErrors = parsed.success
    ? []
    : parsed.error.issues.map((i) => `${i.path.join('.') || '(value)'}: ${i.message}`);

  return {
    data: parsed.success ? (parsed.data as CanonicalData) : data,
    keys: deriveKeys(entityType, data),
    validationErrors,
  };
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function lower(v: unknown): string | null {
  const s = str(v);
  return s ? s.toLowerCase() : null;
}

export function deriveKeys(entityType: EntityType, data: CanonicalData): DerivedKeys {
  const keys: DerivedKeys = {
    dedupeKey: null,
    keyEmail: null,
    keyCode: null,
    keyName: null,
    keyDate: null,
  };

  switch (entityType) {
    case EntityType.PRODUCT:
      keys.keyCode = lower(data.sku);
      keys.keyName = lower(data.name);
      break;
    case EntityType.BOOKING:
      keys.keyCode = lower(data.reference);
      keys.keyName = lower(data.productRef);
      keys.keyDate = toDate(data.startDate);
      break;
    case EntityType.TRAVELER:
      keys.keyEmail = lower(data.email);
      keys.keyName = lower(data.fullName);
      break;
    case EntityType.GUIDE:
      keys.keyEmail = lower(data.email);
      keys.keyName = lower(data.fullName);
      break;
    case EntityType.QUALIFICATION:
      keys.keyCode = lower(data.code);
      keys.keyName = lower(data.name);
      break;
    case EntityType.STAFFING_RULE:
      keys.keyName = lower(data.name);
      break;
  }

  keys.dedupeKey =
    keys.keyEmail ??
    keys.keyCode ??
    keys.keyName ??
    (keys.keyDate ? keys.keyDate.toISOString() : null);

  return keys;
}

function toDate(v: unknown): Date | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
