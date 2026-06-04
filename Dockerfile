FROM node:20-alpine

WORKDIR /app

# Install dependencies first for better caching
COPY package.json package-lock.json* ./
RUN npm install

# Copy source - this layer will change when source changes
COPY . .

# Build Next.js app
RUN npm run build

# Copy static files to standalone directory (needed for CSS/images)
RUN cp -r /app/.next/static /app/.next/standalone/.next/
RUN cp -r /app/public /app/.next/standalone/

# Create data directory
RUN mkdir -p /app/data

# Make startup script executable
RUN chmod +x /app/start.sh

# Expose port
EXPOSE 4600

# Set default env vars
ENV PORT=4600
ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production

# Health check — Next.js must answer on the app port (busybox wget ships in alpine)
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4600/ >/dev/null 2>&1 || exit 1

# Start both enforcer and Next.js
CMD ["/app/start.sh"]
