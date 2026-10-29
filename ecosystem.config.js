module.exports = {
  apps: [
    {
      name: 'options-trading-backend',
      script: './backend/dist/index.js',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 5000
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 5000
      },
      error_file: './logs/backend-error.log',
      out_file: './logs/backend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      max_memory_restart: '500M',
      restart_delay: 4000,
      min_uptime: '10s',
      max_restarts: 10
    },
    {
      name: 'options-trading-frontend',
      script: './frontend/node_modules/.bin/serve',
      args: '-s frontend/build -l 3000 --single',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production'
      },
      env_development: {
        NODE_ENV: 'development'
      },
      error_file: './logs/frontend-error.log',
      out_file: './logs/frontend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      max_memory_restart: '300M',
      restart_delay: 4000,
      min_uptime: '10s',
      max_restarts: 10
    }
  ]
};
