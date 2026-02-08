// Standalone enforcer script that runs in the background
import { startEnforcer } from "./lib/enforcer";
import { getDb } from "./lib/db";

// Initialize DB first
getDb();

console.log("[ENFORCER] Starting standalone enforcer...");
startEnforcer(1);

// Keep the process alive
setInterval(() => {
  console.log("[ENFORCER] Heartbeat", new Date().toISOString());
}, 60000);
