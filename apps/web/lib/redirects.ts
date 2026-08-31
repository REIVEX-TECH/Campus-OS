import { NextResponse } from 'next/server';

/**
 * A redirect with a ROOT-RELATIVE `Location` header, so the browser resolves it
 * against the public origin it is on. Behind a reverse proxy (nginx -> the app),
 * `request.url` is the internal upstream (e.g. http://127.0.0.1:3003), so an
 * absolute redirect built from it points the browser at the wrong host and
 * fails with ERR_CONNECTION_REFUSED. `location` must start with '/'.
 */
export function relativeRedirect(location: string, status = 303): NextResponse {
  return new NextResponse(null, { status, headers: { Location: location } });
}
