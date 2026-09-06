/**
 * Object storage seam.
 *
 * Blobs the product stores (Lost & Found photos today; more later) go through
 * this interface, never a vendor SDK imported from application code (CLAUDE.md
 * §2). The only implementation today is a local filesystem store served by nginx
 * in production and a dev route in development (`@campusos/media`); an
 * S3-compatible adapter (R2 / MinIO / B2 / Supabase) can be added behind the same
 * interface without touching a caller.
 *
 * Keys are opaque to callers: an implementation chooses the on-disk / in-bucket
 * layout. A key is a safe relative path — lowercase hex, digits, and `/_.-`
 * only, no `..` segment — so it can be mapped straight onto a filesystem or a
 * bucket path without traversal. `newObjectKey` builds conforming keys.
 */
export interface StoredObject {
  bytes: Uint8Array;
  contentType: string;
}

export interface ObjectStore {
  /** Write (or overwrite) the object at `key`. */
  put(key: string, bytes: Uint8Array, opts: { contentType: string }): Promise<void>;
  /** Read the object, or null if it does not exist. */
  get(key: string): Promise<StoredObject | null>;
  /** Remove the object. A missing object is not an error. */
  delete(key: string): Promise<void>;
  /**
   * The URL a browser fetches the object from. Relative to the app origin
   * (`/media/<key>`), served by nginx in production and a Next route in
   * development. Callers store the KEY, never the URL, and derive the URL at
   * render time so the serving strategy can change.
   */
  url(key: string): string;
}

/** The one safe key shape every implementation accepts. */
export const OBJECT_KEY_PATTERN = /^(?!.*\.\.)[a-z0-9][a-z0-9/_.-]{0,255}$/;

/** True when `key` is a safe object key (no traversal, allowed characters). */
export function isValidObjectKey(key: string): boolean {
  return OBJECT_KEY_PATTERN.test(key) && !key.includes('//');
}
