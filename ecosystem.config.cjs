// pm2 process definition for the self-hosted VPS deploy (see docs/DEPLOY-VPS.md).
//
// Runs the built Next.js app under a PER-APP Node so it never disturbs the
// system Node other apps use: set CAMPUSOS_NODE to the Node 22 path from
// `nvm which 22` before `pm2 start`. Secrets (DATABASE_URL, ADMIN_SECRET, ...)
// come from the repo-root .env, which you `source` before `pm2 start` so pm2
// captures them into the process and `pm2 save` persists them across reboots.
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
      env: { NODE_ENV: 'production' },
    },
  ],
};
