import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTimezone, getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

// GET /api/activity - list activity log entries
//
// `created_at` is stored as a SQLite UTC string ("2026-09-15 01:32:21") with no zone
// marker, which `new Date(...)` parses as LOCAL time — so the feed silently shifted
// every timestamp by the viewer's UTC offset. Timestamps are returned as explicit
// ISO-8601 UTC, and the timezone to render them in is returned alongside.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");

    const entries = (db
      .prepare(
        `SELECT * FROM activity_log 
         ORDER BY created_at DESC 
         LIMIT ? OFFSET ?`
      )
      .all(limit, offset) as any[])
      .map((e) => ({
        ...e,
        // "YYYY-MM-DD HH:MM:SS" (UTC) -> unambiguous ISO instant
        created_at: e.created_at ? String(e.created_at).replace(" ", "T") + "Z" : null,
      }));

    const total = (db.prepare("SELECT COUNT(*) AS n FROM activity_log").get() as { n: number }).n;

    return NextResponse.json(
      {
        entries,
        total,
        timezone: getTimezone(),
        retentionDays: parseInt(getSetting("activity_retention_days") || "90", 10),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
