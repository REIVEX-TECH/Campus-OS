import { describe, expect, it } from 'vitest';
import { clientKey, rateLimit } from '@/lib/rate-limit';

const headers = (init: Record<string, string>): Headers => new Headers(init);

describe('clientKey', () => {
  it('trusts the proxy, not the caller', () => {
    // nginx sets x-real-ip from the socket; it cannot be chosen by the client.
    expect(clientKey(headers({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '10.0.0.1' }))).toBe(
      '203.0.113.7',
    );
    // The documented proxy APPENDS to X-Forwarded-For, so only the last entry
    // is the proxy's word; the first is whatever the caller sent.
    expect(clientKey(headers({ 'x-forwarded-for': '10.0.0.1, 198.51.100.4' }))).toBe(
      '198.51.100.4',
    );
    expect(clientKey(headers({ 'x-forwarded-for': ' 198.51.100.4 ' }))).toBe('198.51.100.4');
    expect(clientKey(headers({}))).toBe('unknown');
  });
});

describe('rateLimit', () => {
  it('allows a burst up to the limit inside one window, then refuses', () => {
    const key = `test:${Math.random()}`;
    const t0 = 1_000_000;
    expect(rateLimit(key, 2, 1_000, t0)).toBe(true);
    expect(rateLimit(key, 2, 1_000, t0 + 10)).toBe(true);
    expect(rateLimit(key, 2, 1_000, t0 + 20)).toBe(false);
    // A new window starts fresh.
    expect(rateLimit(key, 2, 1_000, t0 + 1_000)).toBe(true);
  });
});
