import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureDomainMembership, type JoinPolicy } from '@campusos/module-identity/membership';
import { findOrCreateUser, issueSession } from '@campusos/module-identity/sessions';

/**
 * Signed in people for the e2e journeys, made the way the sign in route makes
 * them: a user by provider subject, a membership by the tenant's domain
 * policy, a session. Fresh subjects every run, so daily caps and unique names
 * never collide with the last run. Run by the Playwright global setup through
 * tsx; the tokens go to a git ignored file the specs read.
 */

// Outside Next nothing loads .env.local, so read it for the database when the
// shell has none (CI sets the variables outright).
if (!process.env.DATABASE_URL) {
  const envFile = resolve(process.cwd(), '.env.local');
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.trim().replace(/^"|"$/g, '');
    }
  }
}

// The first tenant's join policy, as its config states it: anyone with a
// verified address on the domain is a member. Fixture data, like the /u/lgu
// paths in every spec.
const LGU: JoinPolicy = { slug: 'lgu', joinMode: 'domain', allowedEmailDomains: ['lgu.edu.pk'] };

export type E2ERole = 'owner' | 'member' | 'reporter';
export interface E2ESession {
  token: string;
  handle: string;
  userId: string;
}

const stamp = Date.now().toString(36);
const out: Partial<Record<E2ERole, E2ESession>> = {};
for (const role of ['owner', 'member', 'reporter'] as const) {
  const actor = await findOrCreateUser({
    subject: `e2e-${role}-${stamp}`,
    email: `e2e-${role}-${stamp}@lgu.edu.pk`,
  });
  await ensureDomainMembership(actor, LGU);
  const session = await issueSession(actor, { userAgent: 'playwright' });
  out[role] = { token: session.token, handle: actor.handle, userId: actor.userId };
}
mkdirSync(resolve(process.cwd(), 'e2e/.auth'), { recursive: true });
writeFileSync(resolve(process.cwd(), 'e2e/.auth/sessions.json'), JSON.stringify(out));
console.log(`minted e2e sessions for ${Object.keys(out).join(', ')}`);
process.exit(0);
