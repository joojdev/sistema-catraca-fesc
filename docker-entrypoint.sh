#!/bin/sh
set -e

# Load environment variables from .env
export $(grep -v '^#' .env | xargs)

# Apply migrations (creates SQLite DB if missing)
npx prisma migrate deploy

# Start both scripts with PM2
pm2-runtime start ecosystem.config.js
