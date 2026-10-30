import { describe, expect, it } from 'vitest';
import { problemDetailsSchema } from './problem.js';

describe('problemDetailsSchema', () => {
  it('requires an application code', () => {
    expect(
      problemDetailsSchema.safeParse({ type: 'about:blank', title: 'x', status: 400 }).success,
    ).toBe(false);
    expect(
      problemDetailsSchema.safeParse({
        type: 'about:blank',
        title: 'x',
        status: 400,
        code: 'VALIDATION_FAILED',
      }).success,
    ).toBe(true);
  });
});
