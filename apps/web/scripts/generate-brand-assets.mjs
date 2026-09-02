/**
 * Regenerate every brand asset from the filled logo source. Run when it changes:
 *   pnpm --filter web brand:assets
 *
 * Source: assets/photos/logo_filled.png, a teal disc with a knocked-out mark on
 * black. Everything derives from it so the brand is one consistent silhouette:
 *   - The in-app logo mark (logo-mark.png): the disc on transparent, one look in
 *     both themes (self-contained, so it reads on light and dark).
 *   - App icons: a transparent disc for the browser tab (favicon.ico, icon.png)
 *     and opaque disc tiles for launchers and the PWA (apple-icon.png,
 *     icon-192/512, maskable), where a solid field is expected.
 *
 * (assets/photos/logo.png, the open teal mark, is kept as an archived alternate
 * and is not used here.) No dependency beyond sharp (Apache-2.0), already used by
 * Next for image optimisation and declared as a devDependency here.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
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

  // In-app logo mark: the filled disc, one silhouette in both themes (it is
  // self-contained, so it reads on light and dark and matches the app icons).
  await writeFile(resolve(PUBLIC, 'logo-mark.png'), await disc(SRC_FILLED, 128));

  console.log('brand assets written from logo_filled.png');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
