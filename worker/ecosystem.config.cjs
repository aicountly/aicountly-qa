/**
 * PM2 process file for the dedicated QA worker.
 * Name MUST stay distinct from smoke / shared workers.
 *
 * Usage (on cPanel host):
 *   cd ~/aicountly-qa-worker
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 */
module.exports = {
  apps: [
    {
      name: 'aicountly-qa-worker',
      script: 'dist/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 20,
      min_uptime: '10s',
      max_memory_restart: '1G',
      time: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
}
