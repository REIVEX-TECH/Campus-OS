// Autonomous portal session. The portal shows a "Continue to Home Page" landing
// (a <form method="POST" action="index.php"> with a `login-btn` submit) that
// upgrades a fresh anonymous PHPSESSID from unactivated → data-allowed. No login
// is required (the old auth wall is gone). An env-supplied session is only an
// optional override (see source.ts).

type Jar = Record<string, string>;

function absorb(jar: Jar, res: Response): void {
  const getSetCookie = (res.headers as { getSetCookie?: () => string[] }).getSetCookie;
  for (const sc of getSetCookie ? getSetCookie.call(res.headers) : []) {
    const pair = sc.split(';')[0] ?? '';
    const eq = pair.indexOf('=');
    if (eq > 0) jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1);
  }
}

function cookieHeader(jar: Jar): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

export interface PortalSession {
  cookie: string;
  kind: 'autonomous' | 'env-override';
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Mint an anonymous session and activate it via the "Continue" POST.
 *
 * The host is fronted by Cloudflare but intermittently round-robins to an edge
 * that 404s without setting PHPSESSID. That is infrastructure flakiness, not a
 * block, so we retry the initial GET (with backoff) until the real portal
 * answers and sets the cookie, then activate. A genuine block would surface as a
 * 403/429 handled elsewhere.
 */
export async function createAutonomousSession(
  baseUrl: string,
  userAgent: string,
  maxAttempts = 6,
): Promise<PortalSession> {
  const headers = { 'User-Agent': userAgent, Accept: 'text/html,application/xhtml+xml,*/*' };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const jar: Jar = {};
    try {
      const root = await fetch(`${baseUrl}/index.php`, { headers, redirect: 'manual' });
      await root.text();
      absorb(jar, root);
    } catch {
      // network hiccup; fall through to backoff
    }

    if (jar['PHPSESSID']) {
      const cont = await fetch(`${baseUrl}/index.php`, {
        method: 'POST',
        headers: {
          ...headers,
          Cookie: cookieHeader(jar),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ 'login-btn': '' }).toString(),
        redirect: 'manual',
      });
      await cont.text();
      absorb(jar, cont);
      return { cookie: cookieHeader(jar), kind: 'autonomous' };
    }

    if (attempt < maxAttempts) await sleep(1500 * attempt);
  }

  throw new Error('failed to mint PHPSESSID from portal after retries');
}
