import { z } from 'zod';

export type AttributeType = 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'ENUM' | 'MULTI_ENUM';

export interface AttributeDef {
  key: string;
  label: string;
  type: AttributeType;
  unit?: string | null;
  options?: Array<{ value: string; label: string }> | null;
  required?: boolean;
}

function valueSchema(def: AttributeDef): z.ZodType {
  const values = (def.options ?? []).map((o) => o.value);
  switch (def.type) {
    case 'ENUM':
      return z.enum(values as [string, ...string[]]);
    case 'MULTI_ENUM':
      return z.array(z.enum(values as [string, ...string[]])).max(values.length);
    case 'NUMBER':
      return z.number().finite().min(0).max(1_000_000);
    case 'BOOLEAN':
      return z.boolean();
    case 'TEXT':
      return z.string().trim().min(1).max(100);
  }
}

/**
 * SPEC §10.3: the attribute schema of a category is built at runtime from its definitions.
 * Unknown keys are rejected; `partial` (drafts) makes every attribute optional.
 */
export function buildAttributesSchema(defs: readonly AttributeDef[], { partial = false } = {}) {
  const shape = Object.fromEntries(
    defs.map((d) => [d.key, d.required && !partial ? valueSchema(d) : valueSchema(d).optional()]),
  );
  return z.strictObject(shape);
}
