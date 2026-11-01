import { z } from 'zod';
import { PARCEL_SIZES } from './listings.js';

const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'SLUG_INVALID')
  .max(80);
const name = z.string().trim().min(2, 'required').max(100);

/** Back-office catalog editor (SPEC §3.10). No deletes: listings reference the rows. */
export const departmentSchema = z.object({
  slug,
  name,
  position: z.number().int().min(0).max(1000).default(0),
  icon: z.string().trim().max(40).nullable().optional(),
});
export const categorySchema = z.object({
  departmentId: z.uuid(),
  parentId: z.uuid().nullable().optional(),
  slug,
  name,
  position: z.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
  shippable: z.boolean().default(true),
  defaultParcelSize: z.enum(PARCEL_SIZES).nullable().optional(),
});
export const attributeSchema = z.object({
  key: z.string().regex(/^[a-z][a-zA-Z0-9]{1,39}$/, 'KEY_INVALID'),
  label: name,
  type: z.enum(['TEXT', 'NUMBER', 'BOOLEAN', 'ENUM', 'MULTI_ENUM']),
  unit: z.string().trim().max(20).nullable().optional(),
  options: z
    .array(z.object({ value: z.string().min(1).max(60), label: z.string().min(1).max(60) }))
    .max(100)
    .nullable()
    .optional(),
  isFilterable: z.boolean().default(false),
});
export const categoryAttributesSchema = z.object({
  attributes: z
    .array(z.object({ attributeId: z.uuid(), required: z.boolean().default(false) }))
    .max(40),
});
export const brandSchema = z.object({
  name,
  slug,
  aliases: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  isVerified: z.boolean().default(true),
});

export interface AdminCatalog {
  departments: Array<z.infer<typeof departmentSchema> & { id: string }>;
  categories: Array<
    z.infer<typeof categorySchema> & {
      id: string;
      attributes: Array<{ attributeId: string; required: boolean }>;
    }
  >;
  attributes: Array<z.infer<typeof attributeSchema> & { id: string }>;
}
