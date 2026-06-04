import { NextResponse } from "next/server";
import { getEnforcerStatus, isAdminTokenConfigured } from "@/lib/settings";

// Must be evaluated per-request against the live DB — never statically prerendered
// at build time (when there is no DB/token, which baked in a false "not configured").
export const dynamic = "force-dynamic";

// GET /api/enforcer/status — health record for the dashboard banner.
// (Auth is enforced by middleware.ts; this route only reads non-sensitive status.)
export async function GET() {
  try {
    const status = getEnforcerStatus();
    return NextResponse.json({
      lastRun: status?.last_run ?? null,
      lastSuccess: status?.last_success ?? null,
      lastError: status?.last_error ?? null,
      consecutiveFailures: status?.consecutive_failures ?? 0,
      tokenValid: status ? status.token_valid === 1 : true,
      lastBackupAt: status?.last_backup_at ?? null,
      tokenConfigured: isAdminTokenConfigured(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
