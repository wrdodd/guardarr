import { startEnforcer } from "@/lib/enforcer";

// Track if enforcer is already started (singleton)
let enforcerStarted = false;

export async function GET() {
  if (!enforcerStarted) {
    console.log("[STARTUP] Starting rule enforcer...");
    startEnforcer(1); // Check every minute
    enforcerStarted = true;
    return Response.json({ status: "enforcer started" });
  }
  return Response.json({ status: "already running" });
}
