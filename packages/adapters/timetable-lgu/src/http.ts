import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixtureFor } from './portal';

/** Portal transport: every real endpoint is a POST returning HTML. */
export interface HttpClient {
  post(path: string, params: Record<string, string>): Promise<string>;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Statuses that look like rate limiting or a bot block. We NEVER retry these:
// the crawl aborts and reports rather than hammering the portal.
const BLOCK_STATUSES = new Set([403, 429, 503]);

export class PortalBlockedError extends Error {
  constructor(
    readonly status: number,
    path: string,
  ) {
    super(`portal returned ${status} on /${path} (rate limit or block); aborting`);
    this.name = 'PortalBlockedError';
  }
}

/**
 * Live client: POSTs to the portal with the session cookie, following the
 * portal's redirects, with a polite delay between requests. Transient failures
 * (network, 5xx) are retried with exponential backoff; a block-like status
 * throws PortalBlockedError immediately so the crawl stops instead of hammering.
 */
export function createLiveHttpClient(
  baseUrl: string,
  cookie: string,
  userAgent: string,
  delayMs = 1200,
  maxRetries = 3,
): HttpClient {
  let first = true;
  return {
    async post(path, params) {
      if (!first) await sleep(delayMs);
      first = false;
      let attempt = 0;
      for (;;) {
        try {
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
          if (BLOCK_STATUSES.has(res.status)) throw new PortalBlockedError(res.status, path);
          if (!res.ok) throw new Error(`POST /${path} -> HTTP ${res.status}`);
          return await res.text();
        } catch (error) {
          if (error instanceof PortalBlockedError) throw error;
          attempt += 1;
          if (attempt > maxRetries) throw error;
          await sleep(delayMs * 2 ** attempt);
        }
      }
    },
  };
}

/**
 * Recording client: wraps another client and writes every response to its
 * fixture file (scrubbed), so a full crawl captures the whole fixture set as a
 * side effect. The fixture filename comes from the same fixtureFor() the replay
 * client uses, so the recorded set always matches what crawl requests.
 */
export function createRecordingHttpClient(
  inner: HttpClient,
  fixturesDir: string,
  scrub: (html: string) => string,
  onSave?: (file: string, bytes: number) => void,
): HttpClient {
  return {
    async post(path, params) {
      const html = await inner.post(path, params);
      const file = fixtureFor(path, params);
      await writeFile(join(fixturesDir, file), scrub(html), 'utf8');
      onSave?.(file, html.length);
      return html;
    },
  };
}

/** A fixture that was not recorded. In fixture mode this means "this combo is
 * not part of the recorded slice", so the crawl skips it silently rather than
 * treating it as a live error/anomaly. */
export class FixtureMissingError extends Error {
  constructor(readonly file: string) {
    super(`fixture not recorded: ${file}`);
    this.name = 'FixtureMissingError';
  }
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
      try {
        return await readFile(join(fixturesDir, file), 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new FixtureMissingError(file);
        throw error;
      }
    },
  };
}
