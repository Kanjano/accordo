import sharp from 'sharp';
import { detectFormat, processImage, UnsupportedImageError } from './pipeline.js';

/** A JPEG carrying EXIF with GPS coordinates and a 90° orientation flag. */
async function jpegWithGps(): Promise<Buffer> {
  return sharp({ create: { width: 400, height: 200, channels: 3, background: '#c08040' } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExif({
      IFD0: { Make: 'TestCam', Model: 'GPS 1' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '45/1 27/1 51/1',
        GPSLongitudeRef: 'E',
        GPSLongitude: '9/1 11/1 24/1',
      },
    })
    .toBuffer();
}

describe('media pipeline', () => {
  it('test input really carries EXIF and GPS', async () => {
    const meta = await sharp(await jpegWithGps()).metadata();
    expect(meta.exif?.length).toBeGreaterThan(0);
    expect(meta.exif?.toString('latin1')).toContain('TestCam');
    expect(meta.orientation).toBe(6);
  });

  it('no variant contains EXIF, GPS, XMP, IPTC or ICC metadata (SPEC §5.9)', async () => {
    const out = await processImage(await jpegWithGps());
    expect(out.variants.map((v) => v.name)).toEqual([
      '320.webp',
      '640.webp',
      '1280.webp',
      '2048.webp',
      '1280.jpg',
    ]);
    for (const v of out.variants) {
      const meta = await sharp(v.body).metadata();
      expect(meta.exif, v.name).toBeUndefined();
      expect(meta.xmp, v.name).toBeUndefined();
      expect(meta.iptc, v.name).toBeUndefined();
      expect(v.body.toString('latin1')).not.toContain('TestCam');
    }
  });

  it('applies the EXIF orientation before stripping it', async () => {
    const out = await processImage(await jpegWithGps());
    // Orientation 6 = rotate 90°: 400×200 becomes 200×400.
    expect([out.width, out.height]).toEqual([200, 400]);
    const small = await sharp(out.variants[0]?.body).metadata();
    expect(small.height).toBeGreaterThan(small.width as number);
  });

  it('never upscales and computes LQIP and dHash', async () => {
    const out = await processImage(await jpegWithGps());
    expect((await sharp(out.variants[3]?.body).metadata()).height).toBe(400);
    expect(out.blurDataUrl).toMatch(/^data:image\/webp;base64,/);
    expect(out.phash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('rejects files whose magic bytes are not an image', async () => {
    expect(detectFormat(Buffer.from('<?php echo 1;'))).toBeNull();
    await expect(processImage(Buffer.from('GIF89a....'))).rejects.toBeInstanceOf(
      UnsupportedImageError,
    );
  });

  it('recognises PNG and WebP', async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#000' } })
      .png()
      .toBuffer();
    const webp = await sharp(png).webp().toBuffer();
    expect([detectFormat(png), detectFormat(webp)]).toEqual(['png', 'webp']);
  });
});
