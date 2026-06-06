import { z } from 'zod';
import { EntityType } from '@prisma/client';

/**
 * Strongly-typed canonical domain. These Zod schemas are the source of truth
 * for what a canonical entity looks like; the DB stores the validated `data`
 * generically in CanonicalRecord.data. References between entities (e.g.
 * booking -> product) are kept as source natural keys for now and resolved at
 * publish time.
 */

export const ProductSchema = z.object({
  name: z.string().min(1),
  sku: z.string().optional(),
  category: z.string().optional(),
  price: z.number().optional(),
  currency: z.string().optional(),
});

export const BookingSchema = z.object({
  reference: z.string().optional(),
  productRef: z.string().optional(),
  travelerRef: z.string().optional(),
  startDate: z.string().optional(), // ISO date string
});

export const TravelerSchema = z.object({
  fullName: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
});

export const GuideSchema = z.object({
  fullName: z.string().min(1).optional(),
  email: z.string().email().optional(),
});

export const QualificationSchema = z.object({
  code: z.string().optional(),
  name: z.string().optional(),
  guideRef: z.string().optional(),
});

export const StaffingRuleSchema = z.object({
  name: z.string().optional(),
  productRef: z.string().optional(),
  qualificationRef: z.string().optional(),
});

export const CANONICAL_SCHEMAS = {
  [EntityType.PRODUCT]: ProductSchema,
  [EntityType.BOOKING]: BookingSchema,
  [EntityType.TRAVELER]: TravelerSchema,
  [EntityType.GUIDE]: GuideSchema,
  [EntityType.QUALIFICATION]: QualificationSchema,
  [EntityType.STAFFING_RULE]: StaffingRuleSchema,
} satisfies Record<EntityType, z.ZodTypeAny>;

export type CanonicalData = Record<string, unknown>;

/** Canonical field names per entity, with accepted source-header aliases. */
export const FIELD_ALIASES: Record<EntityType, Record<string, string[]>> = {
  [EntityType.PRODUCT]: {
    name: ['name', 'title', 'product', 'product name'],
    sku: ['sku', 'code', 'product code'],
    category: ['category', 'type'],
    price: ['price', 'amount', 'cost'],
    currency: ['currency', 'ccy'],
  },
  [EntityType.BOOKING]: {
    reference: ['reference', 'ref', 'booking', 'booking ref', 'booking reference'],
    productRef: ['product', 'product ref', 'product code', 'sku'],
    travelerRef: ['traveler', 'traveller', 'traveler email', 'customer'],
    startDate: ['start date', 'startdate', 'date', 'departure', 'departure date'],
  },
  [EntityType.TRAVELER]: {
    fullName: ['full name', 'name', 'traveler', 'traveller', 'customer name'],
    email: ['email', 'e-mail', 'mail'],
    phone: ['phone', 'mobile', 'telephone', 'tel'],
  },
  [EntityType.GUIDE]: {
    fullName: ['full name', 'name', 'guide', 'guide name'],
    email: ['email', 'e-mail', 'mail'],
  },
  [EntityType.QUALIFICATION]: {
    code: ['code', 'qualification code', 'qual code'],
    name: ['name', 'qualification', 'title'],
    guideRef: ['guide', 'guide email', 'guide name'],
  },
  [EntityType.STAFFING_RULE]: {
    name: ['name', 'rule', 'rule name'],
    productRef: ['product', 'product code', 'sku'],
    qualificationRef: ['qualification', 'qualification code', 'qual'],
  },
};

/** Fields coerced to a number rather than a trimmed string. */
export const NUMERIC_FIELDS = new Set(['price']);
/** Fields lower-cased and trimmed (emails). */
export const EMAIL_FIELDS = new Set(['email']);
/** Fields parsed to an ISO date string. */
export const DATE_FIELDS = new Set(['startDate']);
