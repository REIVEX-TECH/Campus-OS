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

/** Best-effort client key from proxy headers; falls back to a shared bucket. */
export function clientKey(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? 'unknown';
  return headers.get('x-real-ip') ?? 'unknown';
}
