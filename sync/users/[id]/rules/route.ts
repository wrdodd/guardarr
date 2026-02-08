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

// Apply restrictions via Plex API
async function applyPlexRestrictions(
  plexUserId: string,
  blockedRatings: string,
  token: string
): Promise<boolean> {
  try {
    const filter = `contentRating!=${blockedRatings}`;
    const url = `https://plex.tv/api/users/${plexUserId}?X-Plex-Token=${token}&filterMovies=${encodeURIComponent(
      filter
    )}&filterTelevision=${encodeURIComponent(filter)}`;
    const res = await fetch(url, { method: "PUT" });
    return res.ok;
  } catch {
    return false;
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

// Check if rule should be active based on time
function isRuleActive(rule: any): boolean {
  const timezone = getTimezone();
  const now = new Date();
  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    weekday: "short",
  });

  const parts = timeFormatter.formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0");
  const minute = parts.find((p) => p.type === "minute")?.value || "00";
  const weekday = parts.find((p) => p.type === "weekday")?.value.toLowerCase() || "";

  const dayMap: Record<string, string> = {
    sun: "sun",
    mon: "mon",
    tue: "tue",
    wed: "wed",
    thu: "thu",
    fri: "fri",
    sat: "sat",
  };
  const currentDay = dayMap[weekday.substring(0, 3)] || weekday.substring(0, 3);
  const currentTime = `${String(hour).padStart(2, "0")}:${minute}`;

  const ruleDays = rule.days.split(",");
  if (!ruleDays.includes(currentDay) && !ruleDays.includes("all")) {
    return false;
  }

  const start = rule.start_time;
  const end = rule.end_time;

  if (start <= end) {
    return currentTime >= start && currentTime <= end;
  } else {
    return currentTime >= start || currentTime <= end;
  }
}

// GET /api/users/[id]/rules - get rules assigned to a user
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const rules = db
      .prepare(
        `SELECT r.* FROM rules r
         JOIN user_rules ur ON r.id = ur.rule_id
         WHERE ur.user_id = ?`
      )
      .all(params.id);

    return NextResponse.json(rules);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/users/[id]/rules - assign a rule to a user (and apply immediately if active)
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const { rule_id } = body;

    // Add to database
    db.prepare("INSERT INTO user_rules (user_id, rule_id) VALUES (?, ?) ON CONFLICT DO NOTHING").run(
      params.id,
      rule_id
    );

    // Get user and rule details for immediate application
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(params.id) as any;
    const rule = db.prepare("SELECT * FROM rules WHERE id = ?").get(rule_id) as any;

    if (user && rule && rule.is_active && isRuleActive(rule) && rule.blocked_ratings) {
      const token = getSetting("plex_admin_token");
      if (token) {
        const plexTvId = await getPlexTvUserId(user.plex_username);
        if (plexTvId) {
          const success = await applyPlexRestrictions(plexTvId, rule.blocked_ratings, token);
          if (success) {
            // Save to applied_restrictions table
            db.prepare(
              `INSERT INTO applied_restrictions (user_id, rule_id, plex_tv_id, username, rule_name)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(user_id, rule_id) DO UPDATE SET applied_at = CURRENT_TIMESTAMP`
            ).run(params.id, rule_id, plexTvId, user.plex_username, rule.name);

            // Log to activity
            db.prepare(
              "INSERT INTO activity_log (plex_username, rule_name, action, details) VALUES (?, ?, ?, ?)"
            ).run(
              user.plex_username,
              rule.name,
              "rule_applied",
              `Blocked: ${rule.blocked_ratings} (${formatLocalTime(new Date())})`
            );

            return NextResponse.json({ success: true, applied: true, message: "Rule assigned and applied immediately" });
          }
        }
      }
    }

    return NextResponse.json({ success: true, applied: false, message: "Rule assigned (will apply during active hours)" });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/users/[id]/rules - remove a rule from a user (and remove immediately)
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const { searchParams } = new URL(request.url);
    const rule_id = searchParams.get("rule_id");

    if (!rule_id) {
      return NextResponse.json({ error: "rule_id required" }, { status: 400 });
    }

    // Get user and rule details before deleting
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(params.id) as any;
    const rule = db.prepare("SELECT * FROM rules WHERE id = ?").get(rule_id) as any;
    const applied = db
      .prepare("SELECT * FROM applied_restrictions WHERE user_id = ? AND rule_id = ?")
      .get(params.id, rule_id) as any;

    // Remove from database
    db.prepare("DELETE FROM user_rules WHERE user_id = ? AND rule_id = ?").run(params.id, rule_id);

    // If this restriction was applied, remove it from Plex immediately
    if (user && rule && applied) {
      const token = getSetting("plex_admin_token");
      if (token && applied.plex_tv_id) {
        const success = await removePlexRestrictions(applied.plex_tv_id, token);
        if (success) {
          // Remove from applied_restrictions
          db.prepare("DELETE FROM applied_restrictions WHERE user_id = ? AND rule_id = ?").run(
            params.id,
            rule_id
          );

          // Log to activity
          db.prepare(
            "INSERT INTO activity_log (plex_username, rule_name, action, details) VALUES (?, ?, ?, ?)"
          ).run(
            user.plex_username,
            rule.name,
            "restriction_lifted",
            `Rule unassigned (${formatLocalTime(new Date())})`
          );

          return NextResponse.json({ success: true, removed: true, message: "Rule unassigned and restriction removed immediately" });
        }
      }
    }

    // Clean up applied_restrictions even if Plex API call failed
    if (applied) {
      db.prepare("DELETE FROM applied_restrictions WHERE user_id = ? AND rule_id = ?").run(
        params.id,
        rule_id
      );
    }

    return NextResponse.json({ success: true, removed: false, message: "Rule unassigned" });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
