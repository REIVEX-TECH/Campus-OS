/**
 * Whether a state changing request came from this site's own pages.
 *
 * The session cookie is SameSite=Lax, which already stops a cross site form
 * from carrying it on a POST. This is the second check: browsers put the
 * page's origin on every POST, and a request whose Origin is not this host is
 * refused before anything is read. A request with no Origin at all is refused
 * too; a browser never omits it on a POST, and a script that does is not a page.
 */
export function isSameOrigin(headers: Headers): boolean {
  const origin = headers.get('origin');
  // Behind the reverse proxy the public host is forwarded; locally it is Host.
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * The read-side counterpart of isSameOrigin, for GET (never a state change).
 *
 * A browser omits Origin on a same-origin GET fetch, so isSameOrigin would
 * wrongly refuse the page's own polling. A read needs a weaker guard: the
 * SameSite=Lax session cookie is not sent on a cross site fetch (so a cross
 * origin caller is unauthenticated anyway) and the same origin policy hides the
 * response body from any cross origin script. So allow a missing Origin, and
 * refuse only an Origin that is present and points at another host.
 */
export function isNotCrossOrigin(headers: Headers): boolean {
  const origin = headers.get('origin');
  if (!origin) return true;
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  if (!host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}
