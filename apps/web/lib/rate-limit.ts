// Minimal in-process fixed-window rate limiter. STOPGAP: sufficient for a single
// instance and to slow brute force on the admin login; a hosted deployment with
// many instances should back this with a shared store (documented in
// docs/DEPLOY.md). Never the sole security control.

const windows = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const entry = windows.get(key);
  if (!entry || now >= entry.resetAt) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count += 1;
  return true;
}

/**
 * Best-effort client key from proxy headers; falls back to a shared bucket.
 *
 * `x-real-ip` is set by nginx from the socket and cannot be chosen by the
 * client, so it wins. `X-Forwarded-For` is APPENDED to by the documented proxy
 * config, so the only entry the proxy vouches for is the LAST one; taking the
 * first would let a caller pick a fresh bucket per request.
 */
export function clientKey(headers: Headers): string {
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;
  const fwd = headers.get('x-forwarded-for');
  if (fwd) {
    const hops = fwd
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);
    return hops[hops.length - 1] ?? 'unknown';
  }
  return 'unknown';
}
