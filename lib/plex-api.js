/**
 * Shared plex.tv API access.
 *
 * XML is parsed with fast-xml-parser rather than regex. The previous regex scan
 * over `<User …>` tags now feeds the enforcer's reconcile loop, where a silent
 * mis-parse (attribute reordering, new escaping, multiline tags) would present as
 * filter "drift" and trigger spurious writes to plex.tv.
 */
const { XMLParser } = require("fast-xml-parser");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false, // keep everything as strings; ids stay exact
  trimValues: true,
});

// Always work with arrays — fast-xml-parser collapses single children to an object.
function asArray(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Plex percent-encodes filter values ("label!=Unrated%2CAdult"), and the XML layer
 * escapes entities. Normalize both so comparison against generated filters is valid.
 */
function decodeFilter(v) {
  if (!v) return "";
  let out = String(v);
  try {
    out = decodeURIComponent(out);
  } catch (e) {
    /* stray % that is not an escape sequence — use as-is */
  }
  return out.trim();
}

/**
 * Parse GET /api/users into Map<plexUserId, {username, movies, tv}>.
 * Covers both shared and Home/managed users.
 */
function parseUsers(xml) {
  const doc = parser.parse(xml);
  const users = asArray(doc?.MediaContainer?.User);
  const map = new Map();
  for (const u of users) {
    const id = u["@_id"];
    if (id === undefined) continue;
    map.set(String(id), {
      username: u["@_username"] || u["@_title"] || "",
      movies: decodeFilter(u["@_filterMovies"]),
      tv: decodeFilter(u["@_filterTelevision"]),
    });
  }
  return map;
}

/**
 * Parse shared_servers XML into per-user library access.
 * Each <SharedServer> carries <Section key title type shared="1|0">.
 */
function parseSharedServers(xml) {
  const doc = parser.parse(xml);
  const servers = asArray(doc?.MediaContainer?.SharedServer);
  return servers.map((s) => {
    const libraries = asArray(s.Section).map((sec) => ({
      // `key` is the section id used when writing sharing back.
      key: String(sec["@_key"] ?? ""),
      id: String(sec["@_id"] ?? sec["@_key"] ?? ""),
      title: sec["@_title"] || "",
      type: sec["@_type"] || "",
      shared: String(sec["@_shared"]) === "1",
    }));
    return {
      id: String(s["@_id"] ?? ""),           // sharedServer id — needed for updates
      username: s["@_username"] || "",
      userID: String(s["@_userID"] ?? ""),
      email: s["@_email"] || "",
      libraries,
      sharedCount: libraries.filter((l) => l.shared).length,
      totalLibraries: libraries.length,
    };
  });
}

// ───────────────────────────── HTTP helpers ─────────────────────────────

const PLEX_TV = "https://plex.tv";

async function fetchUsers(token, fetchImpl) {
  const f = fetchImpl || fetch;
  const res = await f(`${PLEX_TV}/api/users?X-Plex-Token=${encodeURIComponent(token)}`, {
    headers: { Accept: "application/xml" },
  });
  if (!res.ok) throw new Error(`plex.tv users fetch failed: ${res.status}`);
  return parseUsers(await res.text());
}

/** Write content-rating/label filters for one user. Empty strings clear them. */
async function putUserFilters(plexUserId, token, movieFilter, tvFilter, fetchImpl) {
  const f = fetchImpl || fetch;
  const params = new URLSearchParams();
  params.set("X-Plex-Token", token);
  params.set("filterMovies", movieFilter || "");
  params.set("filterTelevision", tvFilter || "");
  const res = await f(`${PLEX_TV}/api/users/${plexUserId}?${params.toString()}`, { method: "PUT" });
  if (!res.ok) throw new Error(`Filter write failed: ${res.status}`);
  return true;
}

async function clearUserFilters(plexUserId, token, fetchImpl) {
  return putUserFilters(plexUserId, token, "", "", fetchImpl);
}

/** The server's machineIdentifier, required for every sharing call. */
async function fetchMachineId(serverUrl, token, fetchImpl) {
  const f = fetchImpl || fetch;
  const res = await f(`${String(serverUrl).replace(/\/$/, "")}/`, {
    headers: { "X-Plex-Token": token, Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Could not reach Plex server (${res.status})`);
  const data = await res.json();
  const id = data?.MediaContainer?.machineIdentifier;
  if (!id) throw new Error("Could not determine server machine identifier");
  return id;
}

async function fetchSharedServers(machineId, token, fetchImpl) {
  const f = fetchImpl || fetch;
  const res = await f(`${PLEX_TV}/api/servers/${machineId}/shared_servers?X-Plex-Token=${encodeURIComponent(token)}`, {
    headers: { Accept: "application/xml" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`plex.tv shared_servers error (${res.status})`);
  return parseSharedServers(await res.text());
}

/**
 * Replace the set of libraries a shared user can see.
 *
 * WRITES LIVE PLEX SHARING. `sectionIds` is the COMPLETE list of section keys the
 * user should retain — anything omitted is unshared. An empty list would remove all
 * access, so callers must guard against passing one accidentally.
 */
async function putSharedLibraries(machineId, sharedServerId, sectionIds, token, fetchImpl) {
  const f = fetchImpl || fetch;
  const body = new URLSearchParams();
  body.set("X-Plex-Token", token);
  for (const id of sectionIds) body.append("sharedServer[librarySectionIds][]", String(id));
  const res = await f(`${PLEX_TV}/api/servers/${machineId}/shared_servers/${sharedServerId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/xml" },
    body: body.toString(),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Sharing update failed (${res.status})`);
  return true;
}

module.exports = {
  parseUsers, parseSharedServers, decodeFilter, asArray,
  fetchUsers, putUserFilters, clearUserFilters,
  fetchMachineId, fetchSharedServers, putSharedLibraries,
};
