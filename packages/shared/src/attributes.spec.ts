import { describe, expect, it } from 'vitest';
import { type AttributeDef, buildAttributesSchema } from './attributes.js';

const defs: AttributeDef[] = [
  {
    key: 'pickupConfig',
    label: 'Pickup',
    type: 'ENUM',
    options: [
      { value: 'hss', label: 'HSS' },
      { value: 'sss', label: 'SSS' },
    ],
    required: true,
  },
  { key: 'leftHanded', label: 'Mancino', type: 'BOOLEAN' },
  { key: 'powerWatts', label: 'Potenza', type: 'NUMBER' },
  { key: 'genre', label: 'Genere', type: 'TEXT' },
  { key: 'tags', label: 'Tag', type: 'MULTI_ENUM', options: [{ value: 'a', label: 'A' }] },
];

describe('buildAttributesSchema', () => {
  it('validates types and options', () => {
    const s = buildAttributesSchema(defs);
    expect(
      s.safeParse({
        pickupConfig: 'hss',
        leftHanded: true,
        powerWatts: 50,
        genre: 'Jazz',
        tags: ['a'],
      }).success,
    ).toBe(true);
    expect(s.safeParse({ pickupConfig: 'xyz' }).success).toBe(false);
    expect(s.safeParse({ pickupConfig: 'hss', powerWatts: -1 }).success).toBe(false);
  });
  it('rejects unknown keys and enforces required ones unless partial', () => {
    expect(
      buildAttributesSchema(defs).safeParse({ pickupConfig: 'hss', color: 'red' }).success,
    ).toBe(false);
    expect(buildAttributesSchema(defs).safeParse({}).success).toBe(false);
    expect(buildAttributesSchema(defs, { partial: true }).safeParse({}).success).toBe(true);
  });
});
