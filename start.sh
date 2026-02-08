#!/bin/sh

# Start the enforcer in background
node /app/enforcer.js &
ENFORCER_PID=$!

echo "[STARTUP] Enforcer started (PID: $ENFORCER_PID)"

# Start Next.js
exec node /app/.next/standalone/server.js
