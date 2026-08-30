import type { AdapterConfig } from './config';
import type { HttpClient } from './http';

export type SessionPath = 'bootstrap' | 'env' | 'fixture';

export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

export function recoveryMessage(baseUrl: string): string {
  return [
    'LGU session could not be established. The run aborted without writing anything.',
    'Recovery:',
    `  1. Open ${baseUrl} in a browser and confirm the timetable portal loads.`,
    "  2. Copy a fresh PHPSESSID cookie from your browser's dev tools.",
    '  3. Set it: export LGU_PHPSESSID=<value> (or add it to .env), then re-run.',
    '  4. If the portal itself is down, retry later.',
  ].join('\n');
}

function extractPhpSessId(setCookie: string | null): string | null {
  if (!setCookie) return null;
  return /PHPSESSID=([^;]+)/i.exec(setCookie)?.[1] ?? null;
}

function cookieHeader(id: string | null): Record<string, string> {
  return id ? { cookie: `PHPSESSID=${id}` } : {};
}

export interface EstablishedSession {
  cookie: string | null;
  path: 'bootstrap' | 'env';
}

/**
 * Establish a live session in the documented order (CLAUDE.md §4 / requirement):
 *   (a) bootstrap — mint a PHPSESSID at the portal root, verify with a cheap
 *       metadata probe;
 *   (b) fallback — use LGU_PHPSESSID from env, verified the same way;
 *   (c) failure — abort before writing anything (throws SessionError with a
 *       recovery procedure).
 * The chosen path is logged so we learn whether the portal needs auth at all.
 */
export async function establishSession(
  http: HttpClient,
  config: AdapterConfig,
  log: (message: string) => void,
): Promise<EstablishedSession> {
  const headers = { 'user-agent': config.userAgent };

  try {
    const root = await http.get(config.baseUrl, { headers });
    const minted = extractPhpSessId(root.headers.get('set-cookie'));
    const probe = await http.get(`${config.baseUrl}/api/metadata`, {
      headers: { ...headers, ...cookieHeader(minted) },
    });
    if (probe.ok) {
      log(`session path=bootstrap (minted=${minted ? 'yes' : 'no'})`);
      return { cookie: minted, path: 'bootstrap' };
    }
  } catch {
    // fall through to the env fallback
  }

  if (config.phpSessId) {
    try {
      const probe = await http.get(`${config.baseUrl}/api/metadata`, {
        headers: { ...headers, ...cookieHeader(config.phpSessId) },
      });
      if (probe.ok) {
        log('session path=env');
        return { cookie: config.phpSessId, path: 'env' };
      }
    } catch {
      // fall through to abort
    }
  }

  throw new SessionError(recoveryMessage(config.baseUrl));
}
