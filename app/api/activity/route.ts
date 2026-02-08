import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/activity - list activity log entries
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");

    const entries = db
      .prepare(
        `SELECT * FROM activity_log 
         ORDER BY created_at DESC 
         LIMIT ? OFFSET ?`
      )
      .all(limit, offset);

    return NextResponse.json(entries);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
