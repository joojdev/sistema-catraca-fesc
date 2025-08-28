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
      args: 'dist/fetchTask/index.js',
      watch: false,
    },
  ],
}
