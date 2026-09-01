// pm2 process definition for the self-hosted VPS deploy (see docs/DEPLOY-VPS.md).
//
// Runs the built Next.js app under a PER-APP Node so it never disturbs the
// system Node other apps use: set CAMPUSOS_NODE to the Node 22 path from
// `nvm which 22` before `pm2 start`.
//
// ENV MODEL: every var except NODE_ENV comes from the repo-root .env, which you
// `source` (`set -a; . ./.env; set +a`) BEFORE `pm2 start` so it is present in
// the shell; the `env` block below is STATIC keys (not a `...process.env`
// spread), so it forwards ONLY what is listed here. The host vars are forwarded
// explicitly so a missing one shows up as an empty value at boot rather than
// silently defaulting (DATABASE_URL / ADMIN_SECRET are also sourced this way and
// read directly by the app). If you add a new required env var, add it here too.
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
      env: {
        NODE_ENV: 'production',
        // Sourced from .env before `pm2 start` (see the ENV MODEL note above).
        PORT: process.env.PORT,
        DATABASE_URL: process.env.DATABASE_URL,
        ADMIN_SECRET: process.env.ADMIN_SECRET,
        SOURCE_MODE: process.env.SOURCE_MODE,
        TENANT_BASE_DOMAIN: process.env.TENANT_BASE_DOMAIN,
        PLATFORM_HOST: process.env.PLATFORM_HOST,
        APP_DOMAIN: process.env.APP_DOMAIN,
      },
    },
  ],
};
