module.exports = {
  apps: [
    {
      name: 'Turnstile',
      script: 'node',
      args: 'dist/index.js',
      watch: false,
    },
    {
      name: 'Import',
      script: 'node',
      args: 'dist/infrastructure/tasks/fetch/index.js',
      watch: false,
    },
  ],
}
