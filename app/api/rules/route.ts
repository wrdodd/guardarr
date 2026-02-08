import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSetting, getLocalTime } from "@/lib/settings";

// Normalize rating names to handle Plex variations
function normalizeRating(rating: string): string[] {
  const normalized = rating.trim();
  if (normalized === "NR") return ["NR", "Not Rated"];
  if (normalized === "Not Rated") return ["NR", "Not Rated"];
  return [normalized];
}

// Build filter with normalization
function buildFilter(allowed: string, blocked: string): string {
  if (allowed) {
    const ratings = allowed.split(",").flatMap((r: string) => normalizeRating(r)).filter(Boolean);
    const uniqueRatings = [...new Set(ratings)];
    if (uniqueRatings.length > 0) return `contentRating=${uniqueRatings.join(",")}`;
  } else if (blocked) {
    const ratings = blocked.split(",").flatMap((r: string) => normalizeRating(r)).filter(Boolean);
    const uniqueRatings = [...new Set(ratings)];
    if (uniqueRatings.length > 0) return `contentRating!=${uniqueRatings.join(",")}`;
  }
  return "";
}

// Check if rule should be active now
function isRuleActive(rule: any): boolean {
  const { currentDay, currentTime } = getLocalTime();
  
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

// Apply restriction immediately via Plex API
async function applyRestrictionImmediately(rule: any, token: string) {
  const users = db.prepare(`
    SELECT u.id, u.plex_username, u.plex_id 
    FROM users u 
    JOIN user_rules ur ON u.id = ur.user_id 
    WHERE ur.rule_id = ?
  `).all(rule.id) as any[];

  for (const user of users) {
    try {
      const url = `https://plex.tv/api/users?X-Plex-Token=${token}`;
      const res = await fetch(url);
      if (!res.ok) continue;
      
      const xml = await res.text();
      const userRegex = new RegExp(`<User[^>]*?id="(\\d+)"[^>]*?username="${user.plex_username}"[^>]*?>`, "i");
      const match = xml.match(userRegex);
      const plexTvId = match ? match[1] : null;
      
      if (!plexTvId) continue;

      // Cross-apply TV-MA since it can appear in both libraries
      const movieBlocked = rule.blocked_ratings || "";
      const tvBlocked = rule.blocked_tv_ratings || "";
      const movieAllowed = rule.allowed_ratings || "";
      const tvAllowed = rule.allowed_tv_ratings || "";
      
      const hasTvMaBlocked = (movieBlocked + "," + tvBlocked).split(",").some(r => r.trim() === "TV-MA");
      const hasTvMaAllowed = (movieAllowed + "," + tvAllowed).split(",").some(r => r.trim() === "TV-MA");
      
      let effectiveMovieBlocked = movieBlocked;
      let effectiveTvBlocked = tvBlocked;
      let effectiveMovieAllowed = movieAllowed;
      let effectiveTvAllowed = tvAllowed;
      
      if (hasTvMaBlocked) {
        if (!effectiveMovieBlocked.includes("TV-MA")) {
          effectiveMovieBlocked = effectiveMovieBlocked ? effectiveMovieBlocked + ",TV-MA" : "TV-MA";
        }
        if (!effectiveTvBlocked.includes("TV-MA")) {
          effectiveTvBlocked = effectiveTvBlocked ? effectiveTvBlocked + ",TV-MA" : "TV-MA";
        }
      }
      
      if (hasTvMaAllowed) {
        if (!effectiveMovieAllowed.includes("TV-MA")) {
          effectiveMovieAllowed = effectiveMovieAllowed ? effectiveMovieAllowed + ",TV-MA" : "TV-MA";
        }
        if (!effectiveTvAllowed.includes("TV-MA")) {
          effectiveTvAllowed = effectiveTvAllowed ? effectiveTvAllowed + ",TV-MA" : "TV-MA";
        }
      }
      
      const movieFilter = buildFilter(effectiveMovieAllowed, effectiveMovieBlocked);
      const tvFilter = buildFilter(effectiveTvAllowed, effectiveTvBlocked);

      if (movieFilter || tvFilter) {
        const params = new URLSearchParams();
        params.set("X-Plex-Token", token);
        if (movieFilter) params.set("filterMovies", movieFilter);
        if (tvFilter) params.set("filterTelevision", tvFilter);
        const applyUrl = `https://plex.tv/api/users/${plexTvId}?${params.toString()}`;
        await fetch(applyUrl, { method: "PUT" });
        console.log(`[RULE CREATE] Applied ${rule.name} to ${user.plex_username}: movies=${movieFilter} tv=${tvFilter}`);
      }
    } catch (error) {
      console.error(`[RULE CREATE] Failed to apply to ${user.plex_username}:`, error);
    }
  }
}

// GET /api/rules - list all rules (ordered by priority desc, then name)
export async function GET() {
  try {
    const rules = db.prepare("SELECT * FROM rules ORDER BY COALESCE(priority, 0) DESC, name").all();
    return NextResponse.json(rules);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/rules - create a new rule
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      name,
      is_active,
      days,
      start_time,
      end_time,
      allowed_ratings,
      blocked_ratings,
      allowed_tv_ratings,
      blocked_tv_ratings,
      include_labels,
      exclude_labels,
      priority,
    } = body;

    const result = db.prepare(
      `INSERT INTO rules (name, is_active, days, start_time, end_time, allowed_ratings, blocked_ratings, allowed_tv_ratings, blocked_tv_ratings, include_labels, exclude_labels, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      name,
      is_active ? 1 : 0,
      days,
      start_time,
      end_time,
      allowed_ratings || "",
      blocked_ratings || "",
      allowed_tv_ratings || "",
      blocked_tv_ratings || "",
      include_labels || "",
      exclude_labels || "",
      priority || 0
    );

    // Log the activity
    db.prepare("INSERT INTO activity_log (action, details) VALUES (?, ?)").run(
      "rule_created",
      `Created rule: ${name} (priority: ${priority || 0})`
    );

    // Apply restriction immediately if rule is active and has users assigned
    if (is_active) {
      const rule = db.prepare("SELECT * FROM rules WHERE id = ?").get(result.lastInsertRowid);
      if (rule && isRuleActive(rule)) {
        const token = getSetting("plex_admin_token");
        if (token) {
          // Run in background
          applyRestrictionImmediately(rule, token);
        }
      }
    }

    return NextResponse.json({ success: true, id: result.lastInsertRowid, applied: is_active && isRuleActive(db.prepare("SELECT * FROM rules WHERE id = ?").get(result.lastInsertRowid)) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
