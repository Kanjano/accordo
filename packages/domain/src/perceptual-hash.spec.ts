import { describe, expect, it } from 'vitest';
import { dHashFromGrayscale, hammingDistance, isSimilarImage } from './perceptual-hash.js';

const gradient = (dir: 1 | -1) => Array.from({ length: 72 }, (_, i) => 128 + dir * ((i % 9) * 10));

describe('perceptual hash', () => {
  it('encodes brightness gradients', () => {
    expect(dHashFromGrayscale(gradient(-1))).toBe('ffffffffffffffff');
    expect(dHashFromGrayscale(gradient(1))).toBe('0000000000000000');
  });

  it('rejects wrong sizes', () => {
    expect(() => dHashFromGrayscale([1, 2, 3])).toThrow();
  });

  it('hamming distance and similarity threshold', () => {
    expect(hammingDistance('ffffffffffffffff', '0000000000000000')).toBe(64);
    expect(hammingDistance('00000000000000ff', '0000000000000000')).toBe(8);
    expect(isSimilarImage('000000000000003f', '0000000000000000')).toBe(true);
    expect(isSimilarImage('000000000000007f', '0000000000000000')).toBe(false);
  });
});
