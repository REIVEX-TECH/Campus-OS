import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Before the suite: mint the signed in people the journeys use. Done in a
 * child process under tsx so the identity module runs as it does in the app,
 * against the same database the web server under test reads.
 */
export default function globalSetup(): void {
  execSync('pnpm exec tsx e2e/support/mint-sessions.ts', {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    stdio: 'inherit',
    env: process.env,
  });
}
