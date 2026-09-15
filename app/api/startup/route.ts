import { NextResponse } from "next/server";
import { getEnforcerStatus } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * GET /api/startup — legacy no-op kept so existing callers do not 404.
 *
 * Previously started an in-process enforcement loop. Enforcement now runs only in
 * the standalone enforcer process; see app/api/enforcer/route.ts for why.
 */
export async function GET() {
  const status = getEnforcerStatus();
  return NextResponse.json(
    {
      status: "enforcement runs in the standalone enforcer process",
      lastRun: status?.last_run ?? null,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
