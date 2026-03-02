import { NextResponse } from "next/server";
import { db } from "@/lib/db";

function getSetting(key: string, envKey: string): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value || process.env[envKey] || "";
}

// GET /api/plex-auth/servers — fetch available Plex servers for the admin token
export async function GET() {
  try {
    const token = getSetting("plex_admin_token", "PLEX_ADMIN_TOKEN");

    if (!token) {
      return NextResponse.json({ error: "No admin token configured" }, { status: 400 });
    }

    const res = await fetch(
      "https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1&includeIPv6=1",
      {
        headers: {
          Accept: "application/json",
          "X-Plex-Token": token,
          "X-Plex-Client-Identifier": "guardarr-web",
          "X-Plex-Product": "Guardarr",
        },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!res.ok) {
      return NextResponse.json({ error: `Plex returned ${res.status}` }, { status: 502 });
    }

    const resources = await res.json();

    // Derive a plain http:// URL from a plex.direct hostname (e.g. https://192-168-1-200.xxx.plex.direct:32400 → http://192.168.1.200:32400)
    function plainLocalUrl(uri: string): string | null {
      try {
        const u = new URL(uri);
        const match = u.hostname.match(/^(\d+)-(\d+)-(\d+)-(\d+)\..+\.plex\.direct$/);
        if (match) {
          return `http://${match[1]}.${match[2]}.${match[3]}.${match[4]}:${u.port || 32400}`;
        }
      } catch {}
      return null;
    }

    // Filter to server-type resources only and map to useful shape
    const servers = (Array.isArray(resources) ? resources : [])
      .filter((r: any) => r.provides?.includes("server"))
      .map((r: any) => {
        const connections: any[] = r.connections || [];

        const allConnections = connections.flatMap((c: any) => {
          const entries: { uri: string; local: boolean; relay: boolean; label: string }[] = [];
          // For local plex.direct connections, surface the plain HTTP IP URL first
          if (c.local) {
            const plain = plainLocalUrl(c.uri);
            if (plain) {
              entries.push({ uri: plain, local: true, relay: false, label: "Local (direct IP)" });
            }
            entries.push({ uri: c.uri, local: true, relay: false, label: "Local (plex.direct)" });
          } else {
            entries.push({ uri: c.uri, local: false, relay: !!c.relay, label: c.relay ? "Relay" : "Remote" });
          }
          return entries;
        });

        return {
          name: r.name,
          clientIdentifier: r.clientIdentifier,
          owned: r.owned,
          allConnections,
        };
      })
      .filter((s: any) => s.allConnections.length > 0);

    return NextResponse.json({ servers });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
