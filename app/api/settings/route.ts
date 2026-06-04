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

    // SECURITY: never return the admin token to the client — only whether one is set.
    const tokenConfigured = !!(settings.plex_admin_token || process.env.PLEX_ADMIN_TOKEN);

    return NextResponse.json({
      plex_server_url: settings.plex_server_url || process.env.PLEX_SERVER_URL || "",
      timezone: settings.timezone || "America/Los_Angeles",
      plex_admin_token_configured: tokenConfigured,
      alert_webhook_url: settings.alert_webhook_url || process.env.ALERT_WEBHOOK_URL || "",
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/settings - save settings
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { plex_server_url, plex_admin_token, timezone, alert_webhook_url } = body;

    const upsert = db.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    );

    if (plex_server_url !== undefined) {
      upsert.run("plex_server_url", plex_server_url);
    }
    // Only persist a NON-EMPTY token, so an empty settings field can never wipe a
    // working token (an empty DB token falling back to a stale env var was the root
    // cause of the silent 401 enforcement outage).
    if (plex_admin_token) {
      upsert.run("plex_admin_token", plex_admin_token);
    }
    if (timezone !== undefined) {
      upsert.run("timezone", timezone);
    }
    if (alert_webhook_url !== undefined) {
      upsert.run("alert_webhook_url", alert_webhook_url);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
