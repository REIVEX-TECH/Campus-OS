import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config';
import { PORTAL_PATHS, parseOptions } from './portal';

// Diagnostic ONLY. Replicates the real browser sequence — mint an anonymous
// session at index.php, perform the "Continue to Home Page" action, then hit the
// data endpoints — to decide whether ingestion can be fully autonomous. It also
// tests an optional env-supplied browser session. It NEVER bypasses a Cloudflare
// challenge; it only detects and reports one. Hits the live portal (a handful of
// polite requests): run locally, never in CI. Cookie values are never printed.

const DELAY_MS = 1500;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const ARTIFACT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.probe');

// Real Cloudflare *challenge* signals only — NOT mere "served via Cloudflare".
function isCloudflareChallenge(status: number, headers: Headers, body: string): boolean {
  if ((headers.get('cf-mitigated') ?? '').toLowerCase() === 'challenge') return true;
  const challenge =
    /just a moment/i.test(body) ||
    /attention required/i.test(body) ||
    /challenge-platform/i.test(body) ||
    /cf-browser-verification/i.test(body);
  return challenge && (status === 403 || status === 503 || status === 429);
}

function isLoginPage(body: string): boolean {
  return (
    /<title>[^<]*login/i.test(body) ||
    /continue to home/i.test(body) ||
    /type=["']password["']/i.test(body)
  );
}

function scrub(body: string): string {
  return body
    .replace(/PHPSESSID=[^;"'\s]+/gi, 'PHPSESSID=***')
    .replace(/cf_clearance=[^;"'\s]+/gi, 'cf_clearance=***');
}
function snippet(body: string): string {
  return scrub(body).replace(/\s+/g, ' ').trim().slice(0, 200);
}

type Jar = Record<string, string>;
function absorbCookies(jar: Jar, res: Response): string[] {
  const getSetCookie = (res.headers as { getSetCookie?: () => string[] }).getSetCookie;
  const names: string[] = [];
  for (const sc of getSetCookie ? getSetCookie.call(res.headers) : []) {
    const pair = sc.split(';')[0] ?? '';
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    jar[name] = pair.slice(eq + 1);
    names.push(name);
  }
  return names;
}
function cookieHeader(jar: Jar): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

interface ContinueAction {
  kind: 'link' | 'form' | 'meta' | 'js';
  method: 'GET' | 'POST';
  url: string;
  body: string;
}

/** Best-effort discovery of what "Continue to Home Page" does, from login HTML. */
function discoverContinue(html: string, base: string): ContinueAction | null {
  const abs = (href: string): string => new URL(href, base).toString();

  const anchor = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].find(
    (m) => /continue|home/i.test((m[2] ?? '').replace(/<[^>]*>/g, '')),
  );
  if (anchor?.[1]) return { kind: 'link', method: 'GET', url: abs(anchor[1]), body: '' };

  const form = /<form\b[^>]*action=["']([^"']+)["'][^>]*>([\s\S]*?)<\/form>/gi.exec(html);
  if (form?.[1] && /continue|home/i.test(form[2] ?? '')) {
    const methodMatch = /method=["']([^"']+)["']/i.exec(form[0]);
    const method = (methodMatch?.[1] ?? 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET';
    const hidden = [
      ...(form[2] ?? '').matchAll(
        /<input\b[^>]*name=["']([^"']+)["'][^>]*value=["']([^"']*)["']/gi,
      ),
    ];
    const body = new URLSearchParams(
      Object.fromEntries(hidden.map((h) => [h[1] ?? '', h[2] ?? ''])),
    ).toString();
    return { kind: 'form', method, url: abs(form[1]), body };
  }

  const meta =
    /<meta[^>]*http-equiv=["']refresh["'][^>]*content=["'][^;]*;\s*url=([^"']+)["']/i.exec(html);
  if (meta?.[1]) return { kind: 'meta', method: 'GET', url: abs(meta[1]), body: '' };

  const js = /(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i.exec(html);
  if (js?.[1]) return { kind: 'js', method: 'GET', url: abs(js[1]), body: '' };

  return null;
}

async function postData(
  baseUrl: string,
  path: string,
  jar: Jar,
  ua: string,
  params: Record<string, string>,
) {
  const res = await fetch(`${baseUrl}/${path}`, {
    method: 'POST',
    headers: {
      Cookie: cookieHeader(jar),
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': ua,
      Accept: 'text/html,*/*',
    },
    body: new URLSearchParams(params).toString(),
    redirect: 'manual',
  });
  const body = await res.text();
  return {
    status: res.status,
    options: parseOptions(body).length,
    cf: isCloudflareChallenge(res.status, res.headers, body),
    login: isLoginPage(body),
    body,
  };
}

async function main(): Promise<string> {
  const config = loadConfig();
  const ua = config.userAgent;
  const log = (m: string): void => console.log(`[probe] ${m}`);
  await mkdir(ARTIFACT_DIR, { recursive: true });

  // 1) mint anonymous session
  const rootUrl = `${config.baseUrl}/index.php`;
  const jar: Jar = {};
  log(`GET ${rootUrl}`);
  const rootRes = await fetch(rootUrl, {
    headers: { 'User-Agent': ua, Accept: 'text/html,application/xhtml+xml,*/*' },
    redirect: 'manual',
  });
  const rootBody = await rootRes.text();
  const minted = absorbCookies(jar, rootRes);
  await writeFile(join(ARTIFACT_DIR, 'login-page.html'), scrub(rootBody), 'utf8');
  log(
    `→ ${rootRes.status}; Set-Cookie: ${minted.join(', ') || '(none)'}; title/login-page=${isLoginPage(rootBody)}`,
  );
  log(`saved login HTML to .probe/login-page.html (${rootBody.length} bytes) for inspection`);
  if (isCloudflareChallenge(rootRes.status, rootRes.headers, rootBody)) {
    return 'CLOUDFLARE_CHALLENGE — real CF challenge at the root; not bypassed; needs a human cf_clearance + PHPSESSID.';
  }
  await sleep(DELAY_MS);

  // 2) reproduce "Continue to Home Page"
  const cont = discoverContinue(rootBody, rootUrl);
  if (cont) {
    log(`Continue action: ${cont.kind} ${cont.method} ${cont.url}`);
    const contRes = await fetch(cont.url, {
      method: cont.method,
      headers: {
        Cookie: cookieHeader(jar),
        'User-Agent': ua,
        Accept: 'text/html,*/*',
        ...(cont.method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: cont.method === 'POST' ? cont.body : undefined,
      redirect: 'manual',
    });
    await contRes.text();
    const upgraded = absorbCookies(jar, contRes);
    log(`→ ${contRes.status}; new cookies: ${upgraded.join(', ') || '(none)'}`);
    await sleep(DELAY_MS);
  } else {
    log(
      'Continue action: NOT FOUND in login HTML (may be JS-driven — see .probe/login-page.html / paste the DevTools flow)',
    );
  }

  // 3) anonymous (post-Continue) data endpoints
  log(`POST ${PORTAL_PATHS.semesterPanel} (anonymous, post-Continue)`);
  const anonSem = await postData(config.baseUrl, PORTAL_PATHS.semesterPanel, jar, ua, {});
  log(
    `→ ${anonSem.status}; semester options: ${anonSem.options}; login-page=${anonSem.login}; body: ${snippet(anonSem.body)}`,
  );
  if (anonSem.cf) return 'CLOUDFLARE_CHALLENGE on the data endpoint; not bypassed.';

  // 4) optional env-supplied browser session arm
  const envSession = config.phpSessId;
  const envCf = process.env.LGU_CF_CLEARANCE;
  let envReport =
    'env session: not provided (set LGU_PHPSESSID [+ LGU_CF_CLEARANCE] to test the logged-in path)';
  if (envSession) {
    await sleep(DELAY_MS);
    const envJar: Jar = { PHPSESSID: envSession, ...(envCf ? { cf_clearance: envCf } : {}) };
    log(`POST ${PORTAL_PATHS.semesterPanel} (env-supplied session)`);
    const envSem = await postData(config.baseUrl, PORTAL_PATHS.semesterPanel, envJar, ua, {});
    log(`→ ${envSem.status}; semester options: ${envSem.options}; login-page=${envSem.login}`);
    envReport = `env session: ${envSem.options} semester options (login-page=${envSem.login})`;
  }

  // 5) classify on DATA endpoint results
  if (anonSem.options > 0) {
    return `ANONYMOUS_OK — the post-Continue anonymous session returned ${anonSem.options} semesters. Fully autonomous ingestion is possible (no human cookie). [${envReport}]`;
  }
  if (envSession && /\d/.test(envReport) && !envReport.includes(': 0 ')) {
    return `SESSION_REQUIRED — anonymous returned no data but the env browser session did. A human-supplied PHPSESSID is needed. [${envReport}]`;
  }
  return `SESSION_REQUIRED_OR_CONTINUE_UNRESOLVED — anonymous returned no dropdown data (login-page=${anonSem.login}), not a CF challenge. Either Continue wasn't reproduced correctly (check .probe/login-page.html or paste the DevTools Network flow) or the data endpoints need a logged-in cookie. [${envReport}]`;
}

main()
  .then((verdict) => {
    console.log('');
    console.log(`VERDICT: ${verdict}`);
    process.exitCode = 0; // avoid process.exit(): it triggers a tsx/libuv teardown assert on Windows
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
