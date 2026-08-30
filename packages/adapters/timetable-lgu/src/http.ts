import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixtureFor } from './portal';

/** Portal transport: every real endpoint is a POST returning HTML. */
export interface HttpClient {
  post(path: string, params: Record<string, string>): Promise<string>;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Live client: POSTs to the portal with the session cookie, following the
 * portal's redirects, with a polite delay between requests. */
export function createLiveHttpClient(
  baseUrl: string,
  cookie: string,
  userAgent: string,
  delayMs = 1200,
): HttpClient {
  let first = true;
  return {
    async post(path, params) {
      if (!first) await sleep(delayMs);
      first = false;
      const res = await fetch(`${baseUrl}/${path}`, {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': userAgent,
          Accept: 'text/html,application/xhtml+xml,*/*',
        },
        body: new URLSearchParams(params).toString(),
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`POST /${path} → HTTP ${res.status}`);
      return res.text();
    },
  };
}

/** Fixture client: replays recorded HTML from disk; makes zero network calls. */
export function createFixtureHttpClient(
  fixturesDir: string,
): HttpClient & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async post(path, params) {
      const file = fixtureFor(path, params);
      calls.push(file);
      return readFile(join(fixturesDir, file), 'utf8');
    },
  };
}
