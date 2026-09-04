/**
 * Next.js runs `register()` once, at server startup. We use it as the single
 * boot gate: assert the process environment is wired correctly before any
 * request is served. A misconfigured process must fail closed and loud, never
 * degrade silently (see apps/web/lib/app-env.ts for the failure this closes).
 */
export async function register(): Promise<void> {
  // instrumentation also runs in the edge runtime; the env wiring is a Node
  // server concern and `process.exit` only makes sense there.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { assertAppEnv } = await import('./lib/app-env');
  try {
    assertAppEnv();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const rule = '='.repeat(72);
    // A plain throw here is logged by Next but does not reliably stop the
    // server; exit so pm2 shows a failed boot instead of a running-but-broken
    // process.
    console.error(`\n${rule}\nFATAL: ${message}\n${rule}\n`);
    process.exit(1);
  }
}
