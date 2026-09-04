import { readFileSync } from 'node:fs';
import type { Browser, Page } from '@playwright/test';
import type { E2ERole, E2ESession } from './mint-sessions';

/** The people the global setup minted, by role. */
export function sessionFor(role: E2ERole): E2ESession {
  const all = JSON.parse(
    readFileSync(new URL('../.auth/sessions.json', import.meta.url), 'utf8'),
  ) as Record<E2ERole, E2ESession>;
  return all[role];
}

/** A fresh page signed in as one of them, by the session cookie the app sets. */
export async function pageAs(browser: Browser, role: E2ERole): Promise<Page> {
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: 'campusos_session',
      value: sessionFor(role).token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  return context.newPage();
}
