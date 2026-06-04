import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Auth-gated by middleware. 7-day activity rollup for the dashboard/activity insights.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const since = "datetime('now','-7 days')";
    const total = (db.prepare(`SELECT COUNT(*) n FROM activity_log WHERE created_at >= ${since}`).get() as any).n;
    const byAction = db
      .prepare(`SELECT action, COUNT(*) n FROM activity_log WHERE created_at >= ${since} GROUP BY action ORDER BY n DESC`)
      .all();
    const topUsers = db
      .prepare(
        `SELECT plex_username, COUNT(*) n FROM activity_log
         WHERE created_at >= ${since} AND plex_username IS NOT NULL AND plex_username != 'System'
         GROUP BY plex_username ORDER BY n DESC LIMIT 5`
      )
      .all();
    return NextResponse.json(
      { total, byAction, topUsers },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
