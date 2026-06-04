import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { randomUUID } from "crypto";

const PLEX_HEADERS = (clientId: string) => ({
  Accept: "application/json",
  "Content-Type": "application/json",
  "X-Plex-Client-Identifier": clientId,
  "X-Plex-Product": "Guardarr",
  "X-Plex-Version": "1.0.0",
  "X-Plex-Platform": "Web",
});

function getOrCreateClientId(): string {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get("plex_client_id") as { value: string } | undefined;

  if (row?.value) return row.value;

  const newId = randomUUID();
  db.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  ).run("plex_client_id", newId);
  return newId;
}

// POST /api/plex-auth/pin — request a new Plex PIN
export async function POST() {
  try {
    const clientId = getOrCreateClientId();

    const response = await fetch("https://plex.tv/api/v2/pins", {
      method: "POST",
      headers: PLEX_HEADERS(clientId),
      body: JSON.stringify({ strong: true }),
    });

    if (!response.ok) {
      const body = await response.text();
      return NextResponse.json(
        { error: `Plex PIN error: ${response.status}`, detail: body },
        { status: 502 }
      );
    }

    const data = await response.json();

    return NextResponse.json({
      id: data.id,
      code: data.code,
      clientId,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// GET /api/plex-auth/pin?id=<pinId> — poll for auth token
export async function GET(request: NextRequest) {
  const pinId = request.nextUrl.searchParams.get("id");

  if (!pinId) {
    return NextResponse.json({ error: "Missing pin id" }, { status: 400 });
  }

  try {
    const clientId = getOrCreateClientId();

    const response = await fetch(`https://plex.tv/api/v2/pins/${pinId}`, {
      method: "GET",
      headers: PLEX_HEADERS(clientId),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Plex returned ${response.status}` },
        { status: 502 }
      );
    }

    const data = await response.json();

    if (data.authToken) {
      // Persist the freshly-obtained Plex token as the admin token so the enforcer and
      // every server-side read always have a valid token. Doing this here (at the source,
      // server-side) means ANY sign-in path — login OR the settings popup — updates the DB,
      // and re-signing-in after a token rotation refreshes it automatically. Previously the
      // popup path only filled a form field (needed a manual Save), so the DB stayed empty
      // and the enforcer silently fell back to the stale PLEX_ADMIN_TOKEN env var (401s).
      db.prepare(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
      ).run("plex_admin_token", data.authToken);

      return NextResponse.json({ authorized: true, token: data.authToken });
    }

    return NextResponse.json({ authorized: false });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
