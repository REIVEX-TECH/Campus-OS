/**
 * Room name normalization for auto-create + dedup. A crawled room string is
 * trusted data (rooms are never mapped by hand), so the sink creates a canonical
 * room from it. Formatting varies across crawls, so matching uses a folded key
 * while the display name keeps the original shape.
 */

/**
 * Stable dedup key for matching room strings: case-folded, NFKC-normalized, with
 * every run of non-alphanumeric characters (spaces, hyphens, punctuation)
 * collapsed to a single '-' and edge separators stripped. Formatting variants
 * therefore collapse together ("Lab 15 NB" and "LAB-15-NB" both give
 * "lab-15-nb"; "Kitchen Lab" and "kitchen lab " both give "kitchen-lab").
 *
 * Returns '' for a blank or punctuation-only string, which the caller treats as
 * "no room" (the TBA safety valve), so auto-create only ever fires on a real
 * room string. Uses Unicode letter/number classes, so non-ASCII room names are
 * not stripped to empty.
 */
export function roomDedupKey(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The display name to persist for an auto-created room: the original trimmed,
 * with internal whitespace collapsed to single spaces. Case and punctuation are
 * preserved ("Lab 15 NB", "Kitchen Lab"); first seen wins per dedup key.
 */
export function roomDisplayName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/**
 * The building a room name declares, if it declares one.
 *
 * Campus room strings often end in a short block code ("Lab 15 NB", "Room 7
 * OB"): two or three capital letters after the last space. That code is the
 * only building signal a crawl carries, so it becomes the building's `code`,
 * and the room is filed under it instead of the importer's placeholder. Names
 * without such a suffix return null and stay unassigned: the safety valve is
 * kept deliberately, because guessing a building is worse than admitting none.
 *
 * Only the trailing token is read, and only when the name has more than one
 * token, so a room called "NB" alone is a room, not a building.
 */
export function inferBuildingCode(roomName: string): string | null {
  const tokens = roomDisplayName(roomName).split(' ');
  if (tokens.length < 2) return null;
  const last = tokens[tokens.length - 1]!;
  return /^[A-Z]{2,3}$/.test(last) ? last : null;
}
