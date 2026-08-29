import { describe, expect, it } from 'vitest';
import type { AdapterConfig } from '../src/config';
import type { HttpClient, HttpResponse } from '../src/http';
import { establishSession, SessionError } from '../src/session';

const config: AdapterConfig = {
  mode: 'live',
  baseUrl: 'https://example.test',
  phpSessId: 'env-cookie',
  concurrency: 4,
  userAgent: 'test-agent',
  fixturesDir: '/nope',
};

function res(init: Partial<HttpResponse> & { ok: boolean }): HttpResponse {
  const base: HttpResponse = {
    status: init.ok ? 200 : 403,
    ok: init.ok,
    headers: init.headers ?? new Headers(),
    json: async () => ({}),
    text: async () => '',
  };
  return { ...base, ...init };
}

function client(handler: (url: string) => HttpResponse): HttpClient {
  return { get: async (url) => handler(url) };
}

describe('establishSession', () => {
  it('mints a bootstrap session and verifies it', async () => {
    const http = client((url) =>
      url.endsWith('/api/metadata')
        ? res({ ok: true })
        : res({ ok: true, headers: new Headers({ 'set-cookie': 'PHPSESSID=minted-123; path=/' }) }),
    );
    const session = await establishSession(http, config, () => {});
    expect(session).toEqual({ cookie: 'minted-123', path: 'bootstrap' });
  });

  it('falls back to the env cookie when bootstrap probe fails', async () => {
    let call = 0;
    const http = client((url) => {
      if (!url.endsWith('/api/metadata')) return res({ ok: true }); // root
      call += 1;
      return res({ ok: call > 1 }); // first metadata probe fails, env probe succeeds
    });
    const session = await establishSession(http, config, () => {});
    expect(session).toEqual({ cookie: 'env-cookie', path: 'env' });
  });

  it('aborts with a recovery message when both fail', async () => {
    const http = client(() => res({ ok: false }));
    await expect(establishSession(http, config, () => {})).rejects.toBeInstanceOf(SessionError);
  });
});
