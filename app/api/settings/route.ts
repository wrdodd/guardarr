import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/settings - retrieve all settings
export async function GET() {
  try {
    const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }

    // Fall back to env vars if not in DB
    if (!settings.plex_server_url) {
      settings.plex_server_url = process.env.PLEX_SERVER_URL || "";
    }
    if (!settings.plex_admin_token) {
      settings.plex_admin_token = process.env.PLEX_ADMIN_TOKEN || "";
    }
    if (!settings.timezone) {
      settings.timezone = "America/Los_Angeles";
    }

    return NextResponse.json(settings);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/settings - save settings
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { plex_server_url, plex_admin_token, timezone } = body;

    const upsert = db.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    );

    if (plex_server_url !== undefined) {
      upsert.run("plex_server_url", plex_server_url);
    }
    if (plex_admin_token !== undefined) {
      upsert.run("plex_admin_token", plex_admin_token);
    }
    if (timezone !== undefined) {
      upsert.run("timezone", timezone);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
