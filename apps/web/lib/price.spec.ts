import { describe, expect, it } from 'vitest';
import { centsToInput, parseEuroToCents } from './price';

describe('parseEuroToCents', () => {
  it.each([
    ['650', 65_000],
    ['649,90', 64_990],
    ['649,9', 64_990],
    ['1.250,50', 125_050],
    ['1250.50', 125_050],
    [' 12 € ', 1_200],
    ['0,99', 99],
  ])('%s → %i', (input, cents) => expect(parseEuroToCents(input)).toBe(cents));

  it.each(['', 'abc', '12,345', '-5', '1.25.0'])('rejects %s', (input) =>
    expect(parseEuroToCents(input)).toBeNull(),
  );

  it('round-trips', () => {
    expect(centsToInput(64_990)).toBe('649,90');
    expect(centsToInput(65_000)).toBe('650');
    expect(centsToInput(0)).toBe('');
  });
});
