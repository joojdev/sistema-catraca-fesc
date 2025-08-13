#!/bin/sh
set -e

# Auto-export all sourced variables
set -a
. .env
set +a

# Apply migrations (creates SQLite DB if missing)
npx prisma migrate deploy

# Start both scripts with PM2
pm2-runtime start ecosystem.config.js
