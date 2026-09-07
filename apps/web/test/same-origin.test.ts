import { describe, expect, it } from 'vitest';
import { isNotCrossOrigin, isSameOrigin } from '@/lib/same-origin';

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

describe('isNotCrossOrigin', () => {
  it('accepts a same origin GET that omits Origin', () => {
    // The bug that broke the messages reads: a browser sends no Origin on a
    // same origin GET fetch, so the strict check refused the page's own polling.
    expect(isNotCrossOrigin(headers({ host: 'lgu.campusos.reivex.io' }))).toBe(true);
    expect(
      isNotCrossOrigin(
        headers({ host: '127.0.0.1:3000', 'x-forwarded-host': 'lgu.campusos.reivex.io' }),
      ),
    ).toBe(true);
  });

  it('accepts a present same host Origin', () => {
    expect(
      isNotCrossOrigin(
        headers({ origin: 'https://lgu.campusos.reivex.io', host: 'lgu.campusos.reivex.io' }),
      ),
    ).toBe(true);
  });

  it('refuses a present cross origin Origin', () => {
    expect(
      isNotCrossOrigin(headers({ origin: 'https://evil.example', host: 'lgu.campusos.reivex.io' })),
    ).toBe(false);
    expect(isNotCrossOrigin(headers({ origin: 'not a url', host: 'lgu.campusos.reivex.io' }))).toBe(
      false,
    );
  });
});
