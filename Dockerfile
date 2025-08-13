FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install dependencies first for caching
COPY package*.json tsconfig.json ./
RUN npm install

# Copy source
COPY . .

# Copy environment variables
COPY .env .env

# Generate Prisma Client
RUN npx prisma generate

# Build Typescript scripts
RUN npm run build

# Export port
EXPOSE 3000

# Entrypoint to run migrations before starting scripts
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]