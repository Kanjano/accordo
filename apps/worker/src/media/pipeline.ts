import { dHashFromGrayscale } from '@accordo/domain';
import sharp from 'sharp';

export type ImageFormat = 'jpeg' | 'png' | 'webp';

/** Real file type from magic bytes (the declared Content-Type is not trusted). */
export function detectFormat(buf: Uint8Array): ImageFormat | null {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  const ascii = (from: number, to: number) => String.fromCharCode(...buf.subarray(from, to));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  return null;
}

export const WEBP_WIDTHS = [320, 640, 1280, 2048] as const;

export interface ProcessedImage {
  width: number;
  height: number;
  blurDataUrl: string;
  phash: string;
  variants: Array<{ name: string; body: Buffer; contentType: string }>;
}

export class UnsupportedImageError extends Error {}

/**
 * SPEC §5.9: decode, apply the EXIF orientation, drop every metadata block (GPS included),
 * WebP variants 320/640/1280/2048 + JPEG 1280 for email/Open Graph, LQIP and 64-bit dHash.
 * sharp writes no metadata unless asked to (`keepMetadata`/`withMetadata` are never used here).
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  if (!detectFormat(input)) throw new UnsupportedImageError('Not a JPEG, PNG or WebP file');
  // rotate() without arguments bakes the EXIF orientation into the pixels.
  const base = sharp(input, { failOn: 'error', limitInputPixels: 50_000_000 }).rotate();
  const { data: oriented, info } = await base.toBuffer({ resolveWithObject: true });
  const src = () => sharp(oriented);

  const variants: ProcessedImage['variants'] = [];
  for (const width of WEBP_WIDTHS) {
    variants.push({
      name: `${width}.webp`,
      body: await src()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer(),
      contentType: 'image/webp',
    });
  }
  variants.push({
    name: '1280.jpg',
    body: await src()
      .resize({ width: 1280, withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer(),
    contentType: 'image/jpeg',
  });

  const blur = await src().resize(16).webp({ quality: 40 }).toBuffer();
  const gray = await src().resize(9, 8, { fit: 'fill' }).grayscale().raw().toBuffer();
  return {
    width: info.width,
    height: info.height,
    blurDataUrl: `data:image/webp;base64,${blur.toString('base64')}`,
    phash: dHashFromGrayscale(gray),
    variants,
  };
}
