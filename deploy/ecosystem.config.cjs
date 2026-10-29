// PM2 process file:  pm2 start deploy/ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [{
    name: 'options-trader',
    script: 'server/index.js',
    cwd: __dirname + '/..',
    exec_mode: 'fork', // single process: scanner state and OAuth tokens live in-process
    instances: 1,
    autorestart: true,
    max_memory_restart: '1200M', // full-market scan keeps ~1,200 symbols x 2y of bars in memory
    node_args: '--max-old-space-size=1024',
    env: { NODE_ENV: 'production' },
    out_file: 'data/logs/out.log',
    error_file: 'data/logs/err.log',
    time: true,
  }],
};
