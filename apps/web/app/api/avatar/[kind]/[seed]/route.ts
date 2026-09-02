import { createAvatar } from '@dicebear/core';
import { notionists, shapes } from '@dicebear/collection';
import { z } from 'zod';
import { AVATAR_KINDS, avatarBackground, type AvatarKind } from '@/lib/avatar';

/**
 * Renders a deterministic avatar as SVG.
 *
 * Served from a route rather than inlined because each illustrated avatar is
 * roughly 11KB: a directory of twenty teachers would otherwise add a couple of
 * hundred KB to the HTML on every load. As a response it is fetched once and
 * then cached, and it costs the client no JavaScript at all, since the drawing
 * happens here.
 *
 * The output is a pure function of (kind, seed), so it is safe to cache
 * immutably: the same teacher always resolves to the same picture.
 *
 * People get an illustrated character (Notionists, CC0); rooms get an abstract
 * mark, because a face on a lecture hall reads as a mistake.
 */
const paramsSchema = z.object({
  kind: z.enum(AVATAR_KINDS),
  // Entity ids and slugs only. Keeps the cache key bounded and the seed inert.
  seed: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_.-]+$/),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kind: string; seed: string }> },
) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) return new Response('Not found', { status: 404 });

  const { kind, seed } = parsed.data;
  const svg = render(kind, seed);

  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}

function render(kind: AvatarKind, seed: string): string {
  const backgroundColor = [avatarBackground(seed).replace('#', '')];
  if (kind === 'place') {
    return createAvatar(shapes, { seed, backgroundColor, radius: 50 }).toString();
  }
  return createAvatar(notionists, {
    seed,
    backgroundColor,
    radius: 50,
    // The illustration is drawn tight to the frame otherwise, which crops the
    // hair once the avatar is scaled down to directory size.
    scale: 90,
  }).toString();
}
