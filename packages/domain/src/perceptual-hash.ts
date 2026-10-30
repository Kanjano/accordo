/**
 * dHash (64 bit) from a 9×8 grayscale thumbnail (row-major, 72 bytes).
 * The media worker resizes with sharp and passes the raw pixels here.
 */
export function dHashFromGrayscale(pixels: ArrayLike<number>): string {
  if (pixels.length !== 72) throw new RangeError('dHash expects 9×8 = 72 grayscale pixels');
  let hash = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = pixels[y * 9 + x] ?? 0;
      const right = pixels[y * 9 + x + 1] ?? 0;
      hash = (hash << 1n) | (left > right ? 1n : 0n);
    }
  }
  return hash.toString(16).padStart(16, '0');
}

export function hammingDistance(hexA: string, hexB: string): number {
  let x = BigInt(`0x${hexA}`) ^ BigInt(`0x${hexB}`);
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

/** SPEC §13.5: distance ≤ 6 counts as the same photo. */
export const SIMILAR_IMAGE_MAX_DISTANCE = 6;

export function isSimilarImage(
  hexA: string,
  hexB: string,
  maxDistance = SIMILAR_IMAGE_MAX_DISTANCE,
): boolean {
  return hammingDistance(hexA, hexB) <= maxDistance;
}
