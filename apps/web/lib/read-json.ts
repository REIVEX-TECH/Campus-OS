/**
 * The JSON body of a request, or null when it is not one.
 *
 * A browser cannot send `application/json` cross site without a preflight, but
 * it can send a `text/plain` form whose single field spells out a JSON object.
 * Requiring the content type closes that door before the body is even read;
 * the Origin check and the SameSite cookie are the other two locks.
 */
export async function readJson(request: Request): Promise<unknown> {
  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) return null;
  return request.json().catch(() => null);
}
