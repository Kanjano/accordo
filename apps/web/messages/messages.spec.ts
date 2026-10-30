import { describe, expect, it } from 'vitest';
import en from './en.json' with { type: 'json' };
import it_ from './it.json' with { type: 'json' };

const keys = (o: object, prefix = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );

describe('messages', () => {
  it('en has exactly the same keys as it', () => {
    expect(keys(en).sort()).toEqual(keys(it_).sort());
  });
});
