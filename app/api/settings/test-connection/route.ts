import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Helper to get a setting from DB or env
function getSetting(key: string, envKey: string): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value || process.env[envKey] || "";
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const serverUrl = body.plex_server_url || getSetting("plex_server_url", "PLEX_SERVER_URL");
    const token = body.plex_admin_token || getSetting("plex_admin_token", "PLEX_ADMIN_TOKEN");

    if (!serverUrl || !token) {
      return NextResponse.json({ success: false, error: "Server URL and token are required" }, { status: 400 });
    }

    // Test connection to Plex server
    const url = `${serverUrl.replace(/\/$/, "")}/identity`;
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Plex-Token": token,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return NextResponse.json({
        success: false,
        error: `Plex returned status ${response.status}`,
      });
    }

    const data = await response.json();
    return NextResponse.json({
      success: true,
      serverName: data.MediaContainer?.friendlyName || "Unknown",
      version: data.MediaContainer?.version || "Unknown",
      machineId: data.MediaContainer?.machineIdentifier || "Unknown",
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message || "Connection failed",
    });
  }
}
