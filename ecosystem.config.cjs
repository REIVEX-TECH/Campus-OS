// pm2 process definition for the self-hosted VPS deploy (see docs/DEPLOY-VPS.md).
//
// Runs the built Next.js app under a PER-APP Node so it never disturbs the
// system Node other apps use: set CAMPUSOS_NODE to the Node 22 path from
// `nvm which 22` before `pm2 start`.
//
// ENV MODEL: the runtime env vars the app consumes are declared ONCE in
// apps/web/lib/app-env.vars.json. This file forwards exactly that set — the
// `env` block below is BUILT from the manifest, not hand-maintained — so adding
// a runtime var is a one-line edit to the manifest and can never again be added
// to .env but forgotten here (the bug that silently dropped DATABASE_URL,
// PLATFORM_HOST, TENANT_BASE_DOMAIN and SUPERADMIN_EMAILS in turn). We also load
// .env here so `pm2 restart ecosystem.config.cjs --update-env` re-reads .env
// (restarting by app name does not) and so a value need not be pre-sourced into
// the shell. The app additionally asserts this wiring at boot
// (apps/web/instrumentation.ts) and refuses to start if a declared var did not
// reach the process.
//
// Owner-only and build-time vars are deliberately NOT forwarded: the manifest
// excludes MIGRATION_DATABASE_URL (the owner connection — the running app must
// never hold it) and NEXT_PUBLIC_FIREBASE_* (inlined by Next at build time).
//
// There is no admin secret to forward: admin is a role on an account, so nothing
// in this block can open the admin area. See .env.example.
const path = require('path');

// Best-effort: load .env so its values are present when this config evaluates.
// dotenv does not override vars already set in the shell, so a pre-sourced value
// still wins. If dotenv is absent (a slim install), fall back to a shell that
// sourced .env before `pm2 start`; the boot assertion still catches any gap.
try {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
} catch {
  /* dotenv not installed — see note above */
}

const { vars } = require('./apps/web/lib/app-env.vars.json');

// NODE_ENV is ours to set, not sourced from .env. Everything else is forwarded
// from the process environment by name, driven entirely by the manifest.
const env = { NODE_ENV: 'production' };
for (const v of vars) env[v.name] = process.env[v.name];

module.exports = {
  apps: [
    {
      name: 'campusos',
      cwd: __dirname + '/apps/web',
      script: './node_modules/next/dist/bin/next',
      args: 'start -p ' + (process.env.PORT || '3003'),
      interpreter: process.env.CAMPUSOS_NODE || 'node',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      exp_backoff_restart_delay: 2000,
      env,
    },
  ],
};
