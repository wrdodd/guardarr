import { NextResponse } from "next/server";
import { db } from "@/lib/db";

function getSetting(key: string): string | null {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value || null;
  } catch {
    return null;
  }
}

function getTimezone(): string {
  return getSetting("timezone") || "America/Los_Angeles";
}

function formatLocalTime(date: Date): string {
  const timezone = getTimezone();
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

// Fetch plex.tv user ID for a username
async function getPlexTvUserId(username: string): Promise<string | null> {
  const token = getSetting("plex_admin_token");
  if (!token) return null;

  try {
    const url = `https://plex.tv/api/users?X-Plex-Token=${token}`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const xml = await res.text();
    const userRegex = new RegExp(`<User[^>]*?id="(\\d+)"[^>]*?username="${username}"[^>]*?>`, "i");
    const match = xml.match(userRegex);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// Remove restrictions via Plex API
async function removePlexRestrictions(plexUserId: string, token: string): Promise<boolean> {
  try {
    const url = `https://plex.tv/api/users/${plexUserId}?X-Plex-Token=${token}&filterMovies=&filterTelevision=`;
    const res = await fetch(url, { method: "PUT" });
    return res.ok;
  } catch {
    return false;
  }
}

// POST /api/users/[id]/bypass - create a temporary bypass
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const { minutes } = body;

    if (!minutes || ![15, 30, 60, 120, 240].includes(minutes)) {
      return NextResponse.json({ error: "Invalid duration. Use 15, 30, 60, 120, or 240 minutes." }, { status: 400 });
    }

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(params.id) as any;
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Delete any existing bypass for this user
    db.prepare("DELETE FROM temporary_bypasses WHERE user_id = ?").run(params.id);

    // Create new bypass
    db.prepare(
      `INSERT INTO temporary_bypasses (user_id, minutes, expires_at, created_by)
       VALUES (?, ?, datetime('now', '+' || ? || ' minutes'), 'admin')`
    ).run(params.id, minutes, minutes);

    // Remove any currently applied restrictions from Plex immediately
    const token = getSetting("plex_admin_token");
    if (token) {
      const plexTvId = await getPlexTvUserId(user.plex_username);
      if (plexTvId) {
        await removePlexRestrictions(plexTvId, token);

        // Clean up applied_restrictions table so enforcer knows they were removed
        db.prepare("DELETE FROM applied_restrictions WHERE user_id = ?").run(params.id);
      }
    }

    // Log to activity
    const durationLabel = minutes >= 60 ? `${minutes / 60} hour(s)` : `${minutes} minutes`;
    db.prepare(
      "INSERT INTO activity_log (plex_username, action, details) VALUES (?, ?, ?)"
    ).run(
      user.plex_username,
      "bypass_granted",
      `Temporary bypass granted for ${durationLabel} (${formatLocalTime(new Date())})`
    );

    return NextResponse.json({ success: true, minutes, username: user.plex_username });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// GET /api/users/[id]/bypass - check current bypass status
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const bypass = db.prepare(
      "SELECT * FROM temporary_bypasses WHERE user_id = ? AND expires_at > datetime('now')"
    ).get(params.id) as any;

    if (!bypass) {
      return NextResponse.json({ active: false });
    }

    return NextResponse.json({
      active: true,
      id: bypass.id,
      user_id: bypass.user_id,
      minutes: bypass.minutes,
      expires_at: bypass.expires_at,
      created_by: bypass.created_by,
      created_at: bypass.created_at,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/users/[id]/bypass - cancel a bypass early
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(params.id) as any;
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Delete the bypass
    const result = db.prepare("DELETE FROM temporary_bypasses WHERE user_id = ?").run(params.id);

    if (result.changes > 0) {
      // Log to activity
      db.prepare(
        "INSERT INTO activity_log (plex_username, action, details) VALUES (?, ?, ?)"
      ).run(
        user.plex_username,
        "bypass_cancelled",
        `Temporary bypass cancelled early (${formatLocalTime(new Date())})`
      );
    }

    // The enforcer will re-apply restrictions on next cycle (within 60 seconds)

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
