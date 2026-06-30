// PM2 process definition for dash (duckwerks), adopting the Duck Ops deploy standard.
// cwd points at the `current` symlink, so a reload re-execs against the new release.
// dotenv reads .env from cwd; the release symlinks .env -> /srv/duckwerks/dash/.env.
module.exports = {
  apps: [{
    name: 'duckwerks',
    cwd: '/srv/duckwerks/dash/current',
    script: 'server.js',
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    env: { NODE_ENV: 'production' },
  }],
};
