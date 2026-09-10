/**
 * Keyset (seek) pagination helpers, shared by the browse queries of the content
 * modules (marketplace, lost & found, ...). A cursor is the last row's sort value
 * and id, base64url-encoded as `"<sortVal>|<id>"`, so paging is a `(sortVal, id)`
 * comparison against an index rather than an OFFSET. Extracted verbatim from the
 * per-module copies; behavior is unchanged. Lives here, next to the tenant-context
 * read helpers every browse query already imports.
 */

/** Default page size for a keyset-paginated browse list. */
export const PAGE_SIZE = 24;

/** Encode a keyset cursor from a row's sort value and id. */
export function encodeCursor(sortVal: string, id: string): string {
  return Buffer.from(`${sortVal}|${id}`, 'utf8').toString('base64url');
}

/** Decode a keyset cursor, or null if it is malformed. */
export function decodeCursor(cursor: string): { sortVal: string; id: string } | null {
  try {
    const [sortVal, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (sortVal === undefined || !id) return null;
    return { sortVal, id };
  } catch {
    return null;
  }
}

/** Normalize a timestamptz that the driver may hand back as a string. */
export function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}
