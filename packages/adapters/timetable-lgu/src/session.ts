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

/** Mint an anonymous session and activate it via the "Continue" POST. */
export async function createAutonomousSession(
  baseUrl: string,
  userAgent: string,
): Promise<PortalSession> {
  const jar: Jar = {};
  const headers = { 'User-Agent': userAgent, Accept: 'text/html,application/xhtml+xml,*/*' };

  const root = await fetch(`${baseUrl}/index.php`, { headers, redirect: 'manual' });
  await root.text();
  absorb(jar, root);

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

  if (!jar['PHPSESSID']) throw new Error('failed to mint PHPSESSID from portal');
  return { cookie: cookieHeader(jar), kind: 'autonomous' };
}
