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

# Start both enforcer and Next.js
CMD ["/app/start.sh"]
