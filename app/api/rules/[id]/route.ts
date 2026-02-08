import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSetting, getLocalTime } from "@/lib/settings";

// Check if rule should be active now
function isRuleActive(rule: any): boolean {
  const { currentDay, currentTime } = getLocalTime();
  
  const ruleDays = rule.days.split(',');
  if (!ruleDays.includes(currentDay) && !ruleDays.includes('all')) {
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

// Normalize rating names to handle Plex variations
function normalizeRating(rating: string): string[] {
  const normalized = rating.trim();
  if (normalized === 'NR') return ['NR', 'Not Rated'];
  if (normalized === 'Not Rated') return ['NR', 'Not Rated'];
  return [normalized];
}

// Build filter with normalization
function buildFilter(allowed: string, blocked: string): string {
  if (allowed) {
    const ratings = allowed.split(',').flatMap((r: string) => normalizeRating(r)).filter(Boolean);
    const uniqueRatings = [...new Set(ratings)];
    if (uniqueRatings.length > 0) return `contentRating=${uniqueRatings.join(',')}`;
  } else if (blocked) {
    const ratings = blocked.split(',').flatMap((r: string) => normalizeRating(r)).filter(Boolean);
    const uniqueRatings = [...new Set(ratings)];
    if (uniqueRatings.length > 0) return `contentRating!=${uniqueRatings.join(',')}`;
  }
  return "";
}

// Apply restriction immediately via Plex API
async function applyRestrictionImmediately(rule: any, token: string) {
  // Get all users assigned to this rule
  const users = db.prepare(`
    SELECT u.id, u.plex_username, u.plex_id 
    FROM users u 
    JOIN user_rules ur ON u.id = ur.user_id 
    WHERE ur.rule_id = ?
  `).all(rule.id) as any[];

  for (const user of users) {
    try {
      // Fetch plex.tv user ID
      const url = `https://plex.tv/api/users?X-Plex-Token=${token}`;
      const res = await fetch(url);
      if (!res.ok) continue;
      
      const xml = await res.text();
      const userRegex = new RegExp(`<User[^>]*?id="(\\d+)"[^>]*?username="${user.plex_username}"[^>]*?>`, "i");
      const match = xml.match(userRegex);
      const plexTvId = match ? match[1] : null;
      
      if (!plexTvId) continue;

      // Cross-apply TV-MA since it can appear in both libraries
      const movieBlocked = rule.blocked_ratings || '';
      const tvBlocked = rule.blocked_tv_ratings || '';
      const movieAllowed = rule.allowed_ratings || '';
      const tvAllowed = rule.allowed_tv_ratings || '';
      
      const hasTvMaBlocked = (movieBlocked + ',' + tvBlocked).split(',').some(r => r.trim() === 'TV-MA');
      const hasTvMaAllowed = (movieAllowed + ',' + tvAllowed).split(',').some(r => r.trim() === 'TV-MA');
      
      let effectiveMovieBlocked = movieBlocked;
      let effectiveTvBlocked = tvBlocked;
      let effectiveMovieAllowed = movieAllowed;
      let effectiveTvAllowed = tvAllowed;
      
      if (hasTvMaBlocked) {
        if (!effectiveMovieBlocked.includes('TV-MA')) {
          effectiveMovieBlocked = effectiveMovieBlocked ? effectiveMovieBlocked + ',TV-MA' : 'TV-MA';
        }
        if (!effectiveTvBlocked.includes('TV-MA')) {
          effectiveTvBlocked = effectiveTvBlocked ? effectiveTvBlocked + ',TV-MA' : 'TV-MA';
        }
      }
      
      if (hasTvMaAllowed) {
        if (!effectiveMovieAllowed.includes('TV-MA')) {
          effectiveMovieAllowed = effectiveMovieAllowed ? effectiveMovieAllowed + ',TV-MA' : 'TV-MA';
        }
        if (!effectiveTvAllowed.includes('TV-MA')) {
          effectiveTvAllowed = effectiveTvAllowed ? effectiveTvAllowed + ',TV-MA' : 'TV-MA';
        }
      }
      
      const movieFilter = buildFilter(effectiveMovieAllowed, effectiveMovieBlocked);
      const tvFilter = buildFilter(effectiveTvAllowed, effectiveTvBlocked);

      if (movieFilter || tvFilter) {
        const params = new URLSearchParams();
        params.set('X-Plex-Token', token);
        if (movieFilter) params.set('filterMovies', movieFilter);
        if (tvFilter) params.set('filterTelevision', tvFilter);
        const applyUrl = `https://plex.tv/api/users/${plexTvId}?${params.toString()}`;
        await fetch(applyUrl, { method: 'PUT' });
        console.log(`[RULE UPDATE] Applied ${rule.name} to ${user.plex_username}: movies=${movieFilter} tv=${tvFilter}`);
      }
    } catch (error) {
      console.error(`[RULE UPDATE] Failed to apply to ${user.plex_username}:`, error);
    }
  }
}

// GET /api/rules/[id] - get a single rule
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const rule = db.prepare("SELECT * FROM rules WHERE id = ?").get(params.id);
    if (!rule) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }
    return NextResponse.json(rule);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT /api/rules/[id] - update a rule
export async function PUT(request: Request, { params }: { params: { id: string } }) {
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

    db.prepare(
      `UPDATE rules SET
        name = ?,
        is_active = ?,
        days = ?,
        start_time = ?,
        end_time = ?,
        allowed_ratings = ?,
        blocked_ratings = ?,
        allowed_tv_ratings = ?,
        blocked_tv_ratings = ?,
        include_labels = ?,
        exclude_labels = ?,
        priority = ?,
        updated_at = datetime('now')
       WHERE id = ?`
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
      priority || 0,
      params.id
    );

    // Apply restriction immediately if rule is active
    const rule = db.prepare("SELECT * FROM rules WHERE id = ?").get(params.id);
    if (rule && is_active && isRuleActive(rule)) {
      const token = getSetting("plex_admin_token");
      if (token) {
        // Run in background - don't wait for completion
        applyRestrictionImmediately(rule, token);
      }
    }

    return NextResponse.json({ success: true, applied: is_active && isRuleActive(rule) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/rules/[id] - delete a rule
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    db.prepare("DELETE FROM rules WHERE id = ?").run(params.id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
