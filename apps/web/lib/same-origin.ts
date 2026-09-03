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
