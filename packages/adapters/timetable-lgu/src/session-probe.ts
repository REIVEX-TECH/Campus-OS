import 'dotenv/config';
import { loadConfig } from './config';
import { PORTAL_PATHS, parseOptions } from './portal';

// Diagnostic ONLY. Mints an anonymous session at the portal root, then reuses it
// to POST the real endpoints, to decide whether ingestion can be fully
// autonomous or needs a human-supplied session. It NEVER bypasses or solves a
// Cloudflare challenge — if one is detected it reports and stops. Hits the live
// portal (a handful of polite requests): run locally, never in CI.

const DELAY_MS = 1500;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const CF_MARKERS = [
  /just a moment/i,
  /cf-browser-verification/i,
  /challenge-platform/i,
  /_cf_chl/i,
  /attention required/i,
  /cf-mitigated/i,
];

function isCloudflareChallenge(status: number, body: string): boolean {
  const marked = CF_MARKERS.some((re) => re.test(body));
  return (
    marked || ((status === 403 || status === 503 || status === 429) && /cloudflare/i.test(body))
  );
}

function isLoginForm(body: string): boolean {
  return /type=["']password["']/i.test(body) || /name=["']password["']/i.test(body);
}

function snippet(body: string): string {
  return body
    .replace(/PHPSESSID=[^;"'\s]+/gi, 'PHPSESSID=***')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

interface Cookies {
  phpsessid?: string;
  cfClearance?: string;
  names: string[];
}

function extractCookies(res: Response): Cookies {
  const getSetCookie = (res.headers as { getSetCookie?: () => string[] }).getSetCookie;
  const list = getSetCookie ? getSetCookie.call(res.headers) : [];
  const cookies: Cookies = { names: [] };
  for (const sc of list) {
    const pair = sc.split(';')[0] ?? '';
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1);
    cookies.names.push(name);
    if (name.toLowerCase() === 'phpsessid') cookies.phpsessid = value;
    if (name.toLowerCase() === 'cf_clearance') cookies.cfClearance = value;
  }
  return cookies;
}

function cookieHeader(c: Cookies): string {
  return [
    c.phpsessid ? `PHPSESSID=${c.phpsessid}` : '',
    c.cfClearance ? `cf_clearance=${c.cfClearance}` : '',
  ]
    .filter(Boolean)
    .join('; ');
}

function verdict(name: string, implication: string): never {
  console.log('');
  console.log(`VERDICT: ${name}`);
  console.log(`IMPLICATION: ${implication}`);
  process.exit(0);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const ua = config.userAgent;
  const headersHtml = { 'User-Agent': ua, Accept: 'text/html,application/xhtml+xml,*/*' };
  const log = (m: string): void => console.log(`[probe] ${m}`);

  // 1) bootstrap GET → mint anonymous session
  const rootUrl = `${config.baseUrl}/index.php`;
  log(`GET ${rootUrl}`);
  const rootRes = await fetch(rootUrl, { headers: headersHtml, redirect: 'manual' });
  const rootBody = await rootRes.text();
  const cookies = extractCookies(rootRes);
  log(`→ ${rootRes.status}; Set-Cookie: ${cookies.names.join(', ') || '(none)'}`);
  log(
    `minted anonymous: PHPSESSID=${cookies.phpsessid ? 'yes' : 'no'}, cf_clearance=${cookies.cfClearance ? 'yes' : 'no'}`,
  );
  if (isCloudflareChallenge(rootRes.status, rootBody)) {
    log(`body: ${snippet(rootBody)}`);
    verdict(
      'CLOUDFLARE_CHALLENGE',
      'A Cloudflare bot challenge sits in front of the portal root. We do NOT bypass it. ' +
        'Autonomous minting is impossible; recording/live ingestion need a human-supplied ' +
        'cf_clearance AND PHPSESSID (both copied from a browser that passed the challenge).',
    );
  }
  await sleep(DELAY_MS);

  const cookie = cookieHeader(cookies);
  const postHeaders = {
    Cookie: cookie,
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': ua,
    Accept: 'text/html,*/*',
  };

  // 2) POST semesters with the anonymous session
  log(`POST ${PORTAL_PATHS.semesterPanel}`);
  const semRes = await fetch(`${config.baseUrl}/${PORTAL_PATHS.semesterPanel}`, {
    method: 'POST',
    headers: postHeaders,
    body: '',
    redirect: 'manual',
  });
  const semBody = await semRes.text();
  if (isCloudflareChallenge(semRes.status, semBody)) {
    verdict(
      'CLOUDFLARE_CHALLENGE',
      'Cloudflare challenged the POST despite a minted session. We do NOT bypass it; a ' +
        'human-supplied cf_clearance + PHPSESSID would be required.',
    );
  }
  const semOptions = parseOptions(semBody);
  log(`→ ${semRes.status}; semester options: ${semOptions.length}; body: ${snippet(semBody)}`);
  await sleep(DELAY_MS);

  // 3) POST degrees for the first semester (if any)
  let degreeCount = 0;
  if (semOptions.length > 0) {
    const first = semOptions[0]!;
    log(`POST ${PORTAL_PATHS.ajax} (semester=${first.value})`);
    const degRes = await fetch(`${config.baseUrl}/${PORTAL_PATHS.ajax}`, {
      method: 'POST',
      headers: postHeaders,
      body: new URLSearchParams({ semester: first.value }).toString(),
      redirect: 'manual',
    });
    const degBody = await degRes.text();
    if (isCloudflareChallenge(degRes.status, degBody)) {
      verdict(
        'CLOUDFLARE_CHALLENGE',
        'Cloudflare challenged the degrees POST. We do NOT bypass it.',
      );
    }
    degreeCount = parseOptions(degBody).length;
    log(`→ ${degRes.status}; degree options: ${degreeCount}; body: ${snippet(degBody)}`);
  }

  // 4) classify
  if (semOptions.length > 0 && degreeCount > 0) {
    verdict(
      'ANONYMOUS_OK',
      'The freshly-minted anonymous session returned real dropdown data. Fully autonomous ' +
        'ingestion is possible — the adapter can bootstrap its own session; no human cookie needed.',
    );
  }
  if (isLoginForm(semBody)) {
    verdict(
      'SESSION_REQUIRED',
      'The portal returned a login form to the anonymous session. A real authenticated ' +
        'PHPSESSID (from a logged-in user) is required for recording/live ingestion.',
    );
  }
  verdict(
    'SESSION_REQUIRED',
    'The anonymous session returned no dropdown data (empty/redirect, not a Cloudflare ' +
      'challenge). A human-supplied authenticated PHPSESSID is required.',
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
