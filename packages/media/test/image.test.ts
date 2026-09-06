import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { MediaError, processImage, sniffImageType } from '../src/image';

/** A solid-colour test image at a given size and format. */
async function makeImage(
  width: number,
  height: number,
  format: 'jpeg' | 'png' | 'webp',
): Promise<Buffer> {
  const img = sharp({
    create: { width, height, channels: 3, background: { r: 20, g: 120, b: 90 } },
  });
  if (format === 'jpeg') return img.jpeg().toBuffer();
  if (format === 'png') return img.png().toBuffer();
  return img.webp().toBuffer();
}

describe('sniffImageType', () => {
  it('recognises jpeg, png and webp from their magic bytes', async () => {
    expect(sniffImageType(await makeImage(4, 4, 'jpeg'))).toBe('jpeg');
    expect(sniffImageType(await makeImage(4, 4, 'png'))).toBe('png');
    expect(sniffImageType(await makeImage(4, 4, 'webp'))).toBe('webp');
  });

  it('rejects anything else', () => {
    expect(sniffImageType(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toBeNull();
    expect(sniffImageType(Buffer.from('GIF89a...........'))).toBeNull();
  });
});

describe('processImage', () => {
  it('downscales the display variant, makes a smaller thumbnail, and outputs webp', async () => {
    const input = await makeImage(3000, 2000, 'jpeg');
    const out = await processImage(input, { maxDim: 1600, thumbDim: 400 });

    expect(out.contentType).toBe('image/webp');
    expect(sniffImageType(out.full.bytes)).toBe('webp');
    expect(sniffImageType(out.thumb.bytes)).toBe('webp');
    // Bounded to maxDim on the long edge, aspect preserved.
    expect(out.full.width).toBe(1600);
    expect(out.full.height).toBe(1067);
    const thumbMeta = await sharp(Buffer.from(out.thumb.bytes)).metadata();
    expect(Math.max(thumbMeta.width ?? 0, thumbMeta.height ?? 0)).toBeLessThanOrEqual(400);
    expect(out.thumb.bytes.byteLength).toBeLessThan(out.full.bytes.byteLength);
  });

  it('does not enlarge an image smaller than the bound', async () => {
    const out = await processImage(await makeImage(200, 150, 'png'), { maxDim: 1600 });
    expect(out.full.width).toBe(200);
    expect(out.full.height).toBe(150);
  });

  it('strips EXIF (including anything location-like) from the output', async () => {
    const withExif = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .withExif({ IFD0: { ImageDescription: 'lat=1.23;long=4.56;secret' } })
      .jpeg()
      .toBuffer();
    // Sanity: the input really carries that EXIF.
    expect((await sharp(withExif).metadata()).exif).toBeDefined();

    const out = await processImage(withExif);
    const meta = await sharp(Buffer.from(out.full.bytes)).metadata();
    expect(meta.exif).toBeUndefined();
  });

  it('refuses a non-image (magic-byte check before sharp)', async () => {
    await expect(processImage(Buffer.from('not an image at all, really'))).rejects.toMatchObject({
      code: 'unsupported_type',
    });
  });

  it('refuses an input over the byte limit before decoding', async () => {
    const big = new Uint8Array(11).fill(0xff);
    big[0] = 0xff;
    big[1] = 0xd8;
    big[2] = 0xff; // looks like jpeg, but we cap first
    await expect(processImage(big, { maxBytes: 4 })).rejects.toBeInstanceOf(MediaError);
  });
});
