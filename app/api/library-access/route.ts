import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSetting, formatLocalTime } from "@/lib/settings";
import { createHash } from "crypto";

const { fetchMachineId, fetchSharedServers, putSharedLibraries } = require("@/lib/plex-api.js");

// XML parsing lives in lib/plex-api.js (fast-xml-parser) rather than regex.
export const dynamic = "force-dynamic";

function creds() {
  const token = getSetting("plex_admin_token");
  const serverUrl = getSetting("plex_server_url");
  return { token, serverUrl };
}

// GET — which Plex libraries each shared user can access. Read-only.
export async function GET() {
  try {
    const { token, serverUrl } = creds();
    if (!token || !serverUrl) {
      return NextResponse.json({ error: "Plex server URL and admin token not configured." }, { status: 400 });
    }

    const machineId = await fetchMachineId(serverUrl, token);
    const users = await fetchSharedServers(machineId, token);

    return NextResponse.json(
      { machineId, users, pinRequired: !!getSetting("bypass_pin_hash") },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
}

/**
 * PUT — replace the set of libraries one shared user can see.
 *
 * WRITES LIVE PLEX SHARING and takes effect immediately for that user.
 * Body: { sharedServerId, username, sectionIds: string[], pin?, allowRemoveAll? }
 *
 * `sectionIds` is the COMPLETE list the user should retain; anything omitted is
 * unshared. Because an empty list revokes all access, it is rejected unless the
 * caller explicitly sets allowRemoveAll.
 */
export async function PUT(request: Request) {
  try {
    const { token, serverUrl } = creds();
    if (!token || !serverUrl) {
      return NextResponse.json({ error: "Plex server URL and admin token not configured." }, { status: 400 });
    }

    const body = await request.json();
    const { sharedServerId, username, sectionIds, pin, allowRemoveAll } = body || {};

    if (!sharedServerId) {
      return NextResponse.json({ error: "sharedServerId is required" }, { status: 400 });
    }
    if (!Array.isArray(sectionIds)) {
      return NextResponse.json({ error: "sectionIds must be an array" }, { status: 400 });
    }

    // Same parent-PIN gate that protects granting a bypass — this changes what a
    // user can reach just as directly.
    const pinRow = db.prepare("SELECT value FROM settings WHERE key = 'bypass_pin_hash'").get() as { value: string } | undefined;
    if (pinRow?.value) {
      const provided = createHash("sha256").update(String(pin ?? "")).digest("hex");
      if (provided !== pinRow.value) {
        return NextResponse.json({ error: "Incorrect or missing PIN", pinRequired: true }, { status: 403 });
      }
    }

    if (sectionIds.length === 0 && !allowRemoveAll) {
      return NextResponse.json(
        { error: "Refusing to unshare every library. Set allowRemoveAll to confirm.", confirmRequired: true },
        { status: 409 }
      );
    }

    const machineId = await fetchMachineId(serverUrl, token);

    // Record what actually changed, rather than just "updated".
    const before = (await fetchSharedServers(machineId, token))
      .find((u: any) => String(u.id) === String(sharedServerId));
    const beforeShared: string[] = before ? before.libraries.filter((l: any) => l.shared).map((l: any) => l.title) : [];

    await putSharedLibraries(machineId, sharedServerId, sectionIds, token);

    const after = (await fetchSharedServers(machineId, token))
      .find((u: any) => String(u.id) === String(sharedServerId));
    const afterShared: string[] = after ? after.libraries.filter((l: any) => l.shared).map((l: any) => l.title) : [];

    const added = afterShared.filter((t) => !beforeShared.includes(t));
    const removed = beforeShared.filter((t) => !afterShared.includes(t));
    const summary = [
      added.length ? `+${added.join(", ")}` : "",
      removed.length ? `-${removed.join(", ")}` : "",
    ].filter(Boolean).join(" | ") || "no effective change";

    db.prepare("INSERT INTO activity_log (plex_username, action, details) VALUES (?, ?, ?)")
      .run(
        username || (after?.username ?? "unknown"),
        "library_access_changed",
        `Library access updated: ${summary} (${formatLocalTime(new Date(), { hour12: true })})`
      );

    return NextResponse.json({ success: true, added, removed, libraries: after?.libraries ?? [] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
}
