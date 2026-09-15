import { NextResponse } from "next/server";
import { getEnforcerStatus } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * GET /api/enforcer — report enforcement health.
 *
 * This route used to call startEnforcer(), which span up a SECOND enforcement loop
 * inside the Next.js process from a now-deleted duplicate of the enforcement logic
 * (lib/enforcer.ts). That copy evaluated schedules with new Date().getHours() — i.e.
 * the container's timezone, the bug fixed in v1.1.14 — and knew nothing about
 * durable state or bypasses. Two loops with different rules would fight each other.
 *
 * Enforcement is owned solely by the standalone enforcer process (enforcer.js),
 * which reconciles every 60 seconds. This endpoint only reports on it.
 */
export async function GET() {
  const status = getEnforcerStatus();
  if (!status) {
    return NextResponse.json(
      { running: false, message: "No enforcer status recorded yet." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
  return NextResponse.json(
    {
      running: true,
      owner: "standalone enforcer process (enforcer.js)",
      intervalSeconds: 60,
      ...status,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
