/**
 * Regenerate every brand asset from the two source logos. Run when a source
 * changes:  pnpm --filter web brand:assets
 *
 * Two sources, both a 1254x1254 teal-on-black PNG with no alpha:
 *   assets/photos/logo.png         teal mark on black  (reads on dark surfaces)
 *   assets/photos/logo_filled.png  teal disc with a dark mark on black
 *                                  (reads on light surfaces)
 *
 * From them we derive:
 *   - The in-app logo mark, theme-aware: logo-mark.png (the teal mark, black
 *     turned to alpha) for dark, logo-mark-light.png (the teal disc, circular
 *     alpha) for light. The component swaps them on the theme class.
 *   - App icons from the filled disc: a transparent disc for the browser tab
 *     (favicon.ico, icon.png) and opaque disc tiles for launchers and the PWA
 *     (apple-icon.png, icon-192/512, maskable), where a solid field is expected.
 *
 * For the mark, black -> alpha is exact: a pixel is (facet colour x coverage)
 * over pure black, so dividing by coverage recovers the facet with straight
 * alpha and no dark fringe. No dependency beyond sharp (Apache-2.0), already used
 * by Next for image optimisation and declared as a devDependency here.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const SRC = resolve(repoRoot, 'assets/photos/logo.png');
const SRC_FILLED = resolve(repoRoot, 'assets/photos/logo_filled.png');
const APP = resolve(here, '../app');
const PUBLIC = resolve(here, '../public');

// Trim the black margin so the content fills the frame, then work from that.
function trimmed(src) {
  return sharp(src).trim({ background: '#000000', threshold: 12 }).toBuffer();
}

// A square black tile of `size`px with the content centred at `innerRatio` of
// the frame (the rest is black padding: more padding for maskable safe zones).
async function tile(src, size, innerRatio) {
  const inner = Math.round(size * innerRatio);
  const content = await sharp(await trimmed(src))
    .resize(inner, inner, { fit: 'inside', background: '#000000' })
    .toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 3, background: '#000000' },
  })
    .composite([{ input: content, gravity: 'center' }])
    .png()
    .toBuffer();
}

// The teal mark on transparent: black -> alpha, un-premultiplied so edges stay
// teal (used on the filled-mark source, for dark surfaces).
async function transparentMark(src, size) {
  const { data, info } = await sharp(await trimmed(src))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  // Brightest channel anywhere ~= a solidly covered teal pixel; use it to map
  // coverage so solid facets land at alpha 255, not at teal's own brightness.
  let solidMax = 1;
  for (let i = 0; i < data.length; i += channels) {
    const m = Math.max(data[i], data[i + 1], data[i + 2]);
    if (m > solidMax) solidMax = m;
  }
  const out = Buffer.alloc(width * height * 4);
  for (let p = 0, q = 0; p < data.length; p += channels, q += 4) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const cov = Math.min(1, Math.max(r, g, b) / solidMax); // 0..1 coverage
    const a = Math.round(cov * 255);
    if (a === 0) {
      out[q] = out[q + 1] = out[q + 2] = out[q + 3] = 0;
    } else {
      out[q] = Math.min(255, Math.round(r / cov));
      out[q + 1] = Math.min(255, Math.round(g / cov));
      out[q + 2] = Math.min(255, Math.round(b / cov));
      out[q + 3] = a;
    }
  }
  return sharp(out, { raw: { width, height, channels: 4 } })
    .resize(size, size, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

// The filled disc on transparent: keep the disc, drop the black outside it. The
// filled source is a disc that fills its trimmed bounding box, so a circle mask
// of the same radius keeps the teal disc (and its dark cut-out mark) and clears
// the corners (used on light surfaces and for the browser-tab favicon).
async function disc(src, size) {
  const base = await sharp(await trimmed(src))
    .resize(size, size, { fit: 'fill' })
    .ensureAlpha()
    .toBuffer();
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
  );
  return sharp(base)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

// Assemble a multi-size .ico from PNG entries (PNG-compressed, Vista+).
function ico(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  entries.forEach((e, i) => {
    const o = i * 16;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o);
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o + 1);
    dir.writeUInt16LE(1, o + 4); // colour planes
    dir.writeUInt16LE(32, o + 6); // bits per pixel
    dir.writeUInt32LE(e.buf.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.buf.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.buf)]);
}

async function main() {
  await mkdir(PUBLIC, { recursive: true });

  // Favicon .ico at 16 / 32 / 48 (transparent disc, crisp in the tab).
  const icoEntries = await Promise.all(
    [16, 32, 48].map(async (size) => ({ size, buf: await disc(SRC_FILLED, size) })),
  );
  await writeFile(resolve(APP, 'favicon.ico'), ico(icoEntries));

  // Modern favicon (transparent disc) + apple-touch (opaque, iOS dislikes alpha).
  await writeFile(resolve(APP, 'icon.png'), await disc(SRC_FILLED, 256));
  await writeFile(resolve(APP, 'apple-icon.png'), await tile(SRC_FILLED, 180, 0.92));

  // PWA manifest icons: opaque 192 / 512 "any", plus a 512 maskable safe zone.
  await writeFile(resolve(PUBLIC, 'icon-192.png'), await tile(SRC_FILLED, 192, 0.92));
  await writeFile(resolve(PUBLIC, 'icon-512.png'), await tile(SRC_FILLED, 512, 0.92));
  await writeFile(resolve(PUBLIC, 'icon-maskable-512.png'), await tile(SRC_FILLED, 512, 0.66));

  // In-app logo mark, theme-aware: teal mark for dark, teal disc for light.
  await writeFile(resolve(PUBLIC, 'logo-mark.png'), await transparentMark(SRC, 128));
  await writeFile(resolve(PUBLIC, 'logo-mark-light.png'), await disc(SRC_FILLED, 128));

  console.log('brand assets written from logo.png + logo_filled.png');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
