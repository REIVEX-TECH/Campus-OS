import sharp from 'sharp';

/**
 * Image intake: sniff, strip, downscale, re-encode.
 *
 * User-uploaded photos are never trusted or stored as sent. We sniff the real
 * bytes (not the client's content-type) BEFORE handing anything to sharp, then
 * re-encode to WebP — which drops all metadata, so EXIF (including GPS) never
 * survives — after baking in the orientation tag. Two variants come out: a
 * display image bounded to `maxDim`, and a ~`thumbDim` thumbnail for cards.
 */

export type ImageKind = 'jpeg' | 'png' | 'webp';

export class MediaError extends Error {
  constructor(readonly code: 'unsupported_type' | 'too_large' | 'decode_failed') {
    super(code);
    this.name = 'MediaError';
  }
}

/** The magic bytes we accept. HEIC is deliberately excluded until libheif is verified in the sharp build. */
export function sniffImageType(bytes: Uint8Array): ImageKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'jpeg';
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return 'webp';
  }
  return null;
}

export interface ProcessImageOptions {
  /** Longest edge of the display image. Default 1600. */
  maxDim?: number;
  /** Longest edge of the thumbnail. Default 400. */
  thumbDim?: number;
  /** Reject before decoding if the input exceeds this. Default 5 MiB. */
  maxBytes?: number;
}

export interface ProcessedImage {
  full: { bytes: Uint8Array; width: number; height: number };
  thumb: { bytes: Uint8Array };
  contentType: 'image/webp';
}

/**
 * Validate and re-encode one uploaded image into a display variant and a
 * thumbnail, both WebP with no metadata. Throws {@link MediaError} for an
 * unsupported type, an oversized input, or bytes sharp cannot decode.
 */
export async function processImage(
  input: Uint8Array,
  options: ProcessImageOptions = {},
): Promise<ProcessedImage> {
  const maxDim = options.maxDim ?? 1600;
  const thumbDim = options.thumbDim ?? 400;
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;

  if (input.byteLength > maxBytes) throw new MediaError('too_large');
  if (sniffImageType(input) === null) throw new MediaError('unsupported_type');

  // rotate() with no argument bakes the EXIF orientation into the pixels; the
  // WebP encoder then writes no metadata, so orientation is correct and EXIF
  // (GPS included) is gone. failOn:'error' rejects a corrupt/hostile file.
  const base = sharp(Buffer.from(input), { failOn: 'error' }).rotate();

  let full: { data: Buffer; info: sharp.OutputInfo };
  let thumb: Buffer;
  try {
    full = await base
      .clone()
      .resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    thumb = await base
      .clone()
      .resize({ width: thumbDim, height: thumbDim, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 70 })
      .toBuffer();
  } catch {
    throw new MediaError('decode_failed');
  }

  return {
    full: { bytes: full.data, width: full.info.width, height: full.info.height },
    thumb: { bytes: thumb },
    contentType: 'image/webp',
  };
}
