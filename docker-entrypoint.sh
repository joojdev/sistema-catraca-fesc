#!/bin/sh
set -e

# Apply migrations (creates SQLite DB if missing)
npx prisma migrate deploy

# Start both scripts with PM2
pm2-runtime start ecosystem.config.js
