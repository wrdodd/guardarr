import { NextResponse } from "next/server";
import { getSetting } from "@/lib/settings";

// READ-ONLY. Lists which Plex libraries each shared user can access, from the
// plex.tv shared_servers API. Does NOT modify any sharing.
export const dynamic = "force-dynamic";

function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : "";
}

export async function GET() {
  try {
    const token = getSetting("plex_admin_token");
    const serverUrl = getSetting("plex_server_url");
    if (!token || !serverUrl) {
      return NextResponse.json({ error: "Plex server URL and admin token not configured." }, { status: 400 });
    }

    // 1) server machine identifier
    const idRes = await fetch(`${serverUrl.replace(/\/$/, "")}/`, {
      headers: { "X-Plex-Token": token, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!idRes.ok) return NextResponse.json({ error: `Could not reach Plex server (${idRes.status})` }, { status: 502 });
    const idData = await idRes.json();
    const machineId = idData?.MediaContainer?.machineIdentifier;
    if (!machineId) return NextResponse.json({ error: "Could not determine server machine identifier" }, { status: 502 });

    // 2) shared_servers (XML) — each <SharedServer> lists <Section title shared="1|0">
    const ssRes = await fetch(`https://plex.tv/api/servers/${machineId}/shared_servers?X-Plex-Token=${token}`, {
      headers: { Accept: "application/xml" },
      signal: AbortSignal.timeout(10000),
    });
    if (!ssRes.ok) return NextResponse.json({ error: `plex.tv shared_servers error (${ssRes.status})` }, { status: 502 });
    const xml = await ssRes.text();

    const users: any[] = [];
    const blockRe = /<SharedServer\b([^>]*?)(?:\/>|>([\s\S]*?)<\/SharedServer>)/g;
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(xml))) {
      const open = m[1];
      const inner = m[2] || "";
      const libraries: any[] = [];
      const secRe = /<Section\b([^>]*?)\/?>/g;
      let s: RegExpExecArray | null;
      while ((s = secRe.exec(inner))) {
        libraries.push({
          title: attr(s[1], "title"),
          key: attr(s[1], "key"),
          type: attr(s[1], "type"),
          shared: attr(s[1], "shared") === "1",
        });
      }
      users.push({
        username: attr(open, "username"),
        userID: attr(open, "userID"),
        email: attr(open, "email"),
        libraries,
        sharedCount: libraries.filter((l) => l.shared).length,
        totalLibraries: libraries.length,
      });
    }

    return NextResponse.json(
      { machineId, users },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
