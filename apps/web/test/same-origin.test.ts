import { describe, expect, it } from 'vitest';
import { isSameOrigin } from '@/lib/same-origin';

const headers = (init: Record<string, string>): Headers => new Headers(init);

describe('isSameOrigin', () => {
  it('accepts a POST from this host', () => {
    expect(
      isSameOrigin(
        headers({ origin: 'https://lgu.campusos.reivex.io', host: 'lgu.campusos.reivex.io' }),
      ),
    ).toBe(true);
    expect(isSameOrigin(headers({ origin: 'http://localhost:3000', host: 'localhost:3000' }))).toBe(
      true,
    );
  });

  it('prefers the forwarded host behind the proxy', () => {
    expect(
      isSameOrigin(
        headers({
          origin: 'https://lgu.campusos.reivex.io',
          host: '127.0.0.1:3000',
          'x-forwarded-host': 'lgu.campusos.reivex.io',
        }),
      ),
    ).toBe(true);
  });

  it('refuses another site, a missing origin, and nonsense', () => {
    expect(
      isSameOrigin(headers({ origin: 'https://evil.example', host: 'lgu.campusos.reivex.io' })),
    ).toBe(false);
    expect(isSameOrigin(headers({ host: 'lgu.campusos.reivex.io' }))).toBe(false);
    expect(isSameOrigin(headers({ origin: 'null', host: 'lgu.campusos.reivex.io' }))).toBe(false);
    expect(isSameOrigin(headers({ origin: 'not a url', host: 'lgu.campusos.reivex.io' }))).toBe(
      false,
    );
  });
});
