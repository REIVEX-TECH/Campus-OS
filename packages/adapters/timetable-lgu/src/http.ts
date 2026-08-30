import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface HttpResponse {
  status: number;
  ok: boolean;
  headers: Headers;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface HttpClient {
  get(url: string, opts?: { headers?: Record<string, string> }): Promise<HttpResponse>;
}

/** Real network client. Only used in SOURCE_MODE=live. */
export function createLiveHttpClient(defaultHeaders: Record<string, string> = {}): HttpClient {
  return {
    async get(url, opts) {
      const res = await fetch(url, { headers: { ...defaultHeaders, ...opts?.headers } });
      return {
        status: res.status,
        ok: res.ok,
        headers: res.headers,
        json: () => res.json(),
        text: () => res.text(),
      };
    },
  };
}

function sanitize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Maps a request URL to a fixture file on disk. */
export function fixtureFileFor(fixturesDir: string, url: string): string {
  const parsed = new URL(url);
  if (parsed.pathname.endsWith('/api/metadata')) {
    return join(fixturesDir, 'metadata.json');
  }
  if (parsed.pathname.endsWith('/api/timetable')) {
    const key = [
      parsed.searchParams.get('semester') ?? '',
      parsed.searchParams.get('program') ?? '',
      parsed.searchParams.get('section') ?? '',
    ].join('__');
    return join(fixturesDir, `timetable-${sanitize(key)}.json`);
  }
  throw new Error(`no fixture mapping for ${url}`);
}

/**
 * Replays recorded responses from disk — makes zero network calls. Records every
 * requested URL so tests can assert the live client was never used.
 */
export function createFixtureHttpClient(
  fixturesDir: string,
): HttpClient & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async get(url) {
      calls.push(url);
      const raw = await readFile(fixtureFileFor(fixturesDir, url), 'utf8');
      const data: unknown = JSON.parse(raw);
      return {
        status: 200,
        ok: true,
        headers: new Headers(),
        json: async () => data,
        text: async () => raw,
      };
    },
  };
}
