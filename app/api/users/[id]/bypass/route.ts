import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSetting, getTimezone, formatLocalTime, getLocalTime } from "@/lib/settings";

// Remove restrictions via Plex API
async function removePlexRestrictions(plexUserId: string, token: string): Promise<boolean> {
  try {
    console.log(`[PLEX API] Removing restrictions for plex user ${plexUserId}`);
    const url = `https://plex.tv/api/users/${plexUserId}?X-Plex-Token=${token}&filterMovies=&filterTelevision=`;
    const res = await fetch(url, { method: "PUT" });
    console.log(`[PLEX API] Remove restrictions response: ${res.status} ${res.statusText}`);
    return res.ok;
  } catch (err) {
    console.error(`[PLEX API] Remove restrictions error:`, err);
    return false;
  }
}

// Build a Plex content rating filter string from allowed/blocked ratings
function buildFilter(allowed: string, blocked: string): string {
  if (allowed) {
    const ratings = allowed.split(',').map((r: string) => r.trim()).filter(Boolean);
    if (ratings.length > 0) return `contentRating=${ratings.join(',')}`;
  } else if (blocked) {
    const ratings = blocked.split(',').map((r: string) => r.trim()).filter(Boolean);
    if (ratings.length > 0) return `contentRating!=${ratings.join(',')}`;
  }
  return "";
}

// Apply restrictions via Plex API — handles separate movie and TV ratings
async function applyPlexRestrictions(plexUserId: string, rule: any, token: string): Promise<boolean> {
  try {
    const movieFilter = buildFilter(rule.allowed_ratings || '', rule.blocked_ratings || '');
    const tvFilter = buildFilter(rule.allowed_tv_ratings || '', rule.blocked_tv_ratings || '');
    
    if (!movieFilter && !tvFilter) {
      console.log(`[PLEX API] No filter to apply for rule "${rule.name}" — skipping`);
      return false;
    }
    
    const params = new URLSearchParams();
    params.set('X-Plex-Token', token);
    if (movieFilter) params.set('filterMovies', movieFilter);
    if (tvFilter) params.set('filterTelevision', tvFilter);
    
    console.log(`[PLEX API] Applying restriction for plex user ${plexUserId}: movies=${movieFilter} tv=${tvFilter}`);
    const url = `https://plex.tv/api/users/${plexUserId}?${params.toString()}`;
    const res = await fetch(url, { method: "PUT" });
    console.log(`[PLEX API] Apply restrictions response: ${res.status} ${res.statusText}`);
    return res.ok;
  } catch (err) {
    console.error(`[PLEX API] Apply restrictions error:`, err);
    return false;
  }
}

// POST /api/users/[id]/bypass - create a temporary bypass
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const startTime = Date.now();
  try {
    console.log(`[GRANT BYPASS] === START === user_id=${params.id} at ${new Date().toISOString()}`);
    const body = await request.json();
    const { minutes } = body;

    if (!minutes || ![15, 30, 60, 120, 240].includes(minutes)) {
      return NextResponse.json({ error: "Invalid duration. Use 15, 30, 60, 120, or 240 minutes." }, { status: 400 });
    }

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(params.id) as any;
    if (!user) {
      console.log(`[GRANT BYPASS] User not found: ${params.id}`);
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    console.log(`[GRANT BYPASS] Found user: ${user.plex_username} (plex_id=${user.plex_id})`);

    // Delete any existing bypass for this user
    db.prepare("DELETE FROM temporary_bypasses WHERE user_id = ?").run(params.id);

    // Create new bypass with explicit UTC timestamp
    const now = new Date();
    const expiresAt = new Date(now.getTime() + minutes * 60000);
    const expiresAtStr = expiresAt.toISOString().replace('T', ' ').substring(0, 19);
    
    db.prepare(
      `INSERT INTO temporary_bypasses (user_id, minutes, expires_at, created_by)
       VALUES (?, ?, ?, 'admin')`
    ).run(params.id, minutes, expiresAtStr);
    console.log(`[GRANT BYPASS] Created bypass record: ${minutes} min, expires ${expiresAtStr}`);

    // Use plex_id directly from the database — no extra API call needed!
    const token = getSetting("plex_admin_token");
    const plexTvId = user.plex_id;
    console.log(`[GRANT BYPASS] Token present: ${!!token}, plex_id: ${plexTvId}`);

    if (token && plexTvId) {
      // Fire Plex API call immediately
      const success = await removePlexRestrictions(plexTvId, token);
      console.log(`[GRANT BYPASS] Remove restrictions result: ${success}`);

      // Clean up applied_restrictions table so enforcer knows they were removed
      db.prepare("DELETE FROM applied_restrictions WHERE user_id = ?").run(params.id);
    } else {
      console.warn(`[GRANT BYPASS] Cannot call Plex API — token=${!!token}, plexTvId=${plexTvId}`);
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

    const elapsed = Date.now() - startTime;
    console.log(`[GRANT BYPASS] === DONE === ${elapsed}ms elapsed`);
    return NextResponse.json({ success: true, minutes, username: user.plex_username });
  } catch (error: any) {
    console.error(`[GRANT BYPASS] Error:`, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// GET /api/users/[id]/bypass - check current bypass status
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    // Use current UTC timestamp for comparison
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const bypass = db.prepare(
      "SELECT * FROM temporary_bypasses WHERE user_id = ? AND expires_at > ?"
    ).get(params.id, now) as any;

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
  const startTime = Date.now();
  try {
    console.log(`[CANCEL BYPASS] === START === user_id=${params.id} at ${new Date().toISOString()}`);
    
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(params.id) as any;
    if (!user) {
      console.log(`[CANCEL BYPASS] User not found: ${params.id}`);
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    console.log(`[CANCEL BYPASS] Found user: ${user.plex_username} (plex_id=${user.plex_id})`);

    // Delete the bypass
    const result = db.prepare("DELETE FROM temporary_bypasses WHERE user_id = ?").run(params.id);
    console.log(`[CANCEL BYPASS] Deleted ${result.changes} bypass rows`);

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

    // Immediately re-apply all active rules for this user
    const token = getSetting("plex_admin_token");
    // Use plex_id directly from the database — no extra API call needed!
    const plexTvId = user.plex_id;
    console.log(`[CANCEL BYPASS] Token present: ${!!token}, plex_id: ${plexTvId}`);
    
    if (token && plexTvId) {
      // Get all active rules for this user
      const { currentDay, currentTime } = getLocalTime();
      console.log(`[CANCEL BYPASS] Current: ${currentDay} ${currentTime}`);
      
      const rules = db.prepare(`
        SELECT r.* FROM rules r
        JOIN user_rules ur ON r.id = ur.rule_id
        WHERE ur.user_id = ? AND r.is_active = 1
      `).all(params.id) as any[];
      console.log(`[CANCEL BYPASS] Found ${rules.length} active rules`);

      let appliedCount = 0;
      for (const rule of rules) {
        // Check if rule should be active now
        const ruleDays = rule.days.split(",");
        const isDayActive = ruleDays.includes(currentDay) || ruleDays.includes("all");
        
        let isTimeActive = false;
        if (rule.start_time <= rule.end_time) {
          isTimeActive = currentTime >= rule.start_time && currentTime <= rule.end_time;
        } else {
          isTimeActive = currentTime >= rule.start_time || currentTime <= rule.end_time;
        }

        console.log(`[CANCEL BYPASS] Rule "${rule.name}": dayActive=${isDayActive}, timeActive=${isTimeActive}`);

        if (isDayActive && isTimeActive) {
          // Apply restriction immediately — pass full rule object to handle both allowed/blocked ratings
          const success = await applyPlexRestrictions(plexTvId, rule, token);
          console.log(`[CANCEL BYPASS] Apply rule "${rule.name}" result: ${success}`);
          
          if (success) {
            appliedCount++;
            // Add to applied_restrictions so enforcer knows it's active
            db.prepare(`
              INSERT INTO applied_restrictions (user_id, rule_id, plex_tv_id, username, rule_name)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(user_id, rule_id) DO UPDATE SET applied_at = CURRENT_TIMESTAMP
            `).run(params.id, rule.id, plexTvId, user.plex_username, rule.name);

            // Log the re-application
            const parts: string[] = [];
            if (rule.allowed_ratings) parts.push(`Movies allowed: ${rule.allowed_ratings}`);
            else if (rule.blocked_ratings) parts.push(`Movies blocked: ${rule.blocked_ratings}`);
            if (rule.allowed_tv_ratings) parts.push(`TV allowed: ${rule.allowed_tv_ratings}`);
            else if (rule.blocked_tv_ratings) parts.push(`TV blocked: ${rule.blocked_tv_ratings}`);
            const ratingInfo = parts.join(' | ') || 'No ratings configured';
            db.prepare(
              "INSERT INTO activity_log (plex_username, rule_name, action, details) VALUES (?, ?, ?, ?)"
            ).run(
              user.plex_username,
              rule.name,
              "rule_applied",
              `${ratingInfo} (bypass cancelled, re-applied immediately)`
            );
          }
        }
      }
      console.log(`[CANCEL BYPASS] Applied ${appliedCount}/${rules.length} rules`);
    } else {
      console.warn(`[CANCEL BYPASS] Cannot call Plex API — token=${!!token}, plexTvId=${plexTvId}`);
    }

    const elapsed = Date.now() - startTime;
    console.log(`[CANCEL BYPASS] === DONE === ${elapsed}ms elapsed`);
    return NextResponse.json({ success: true, reapplied: result.changes > 0 });
  } catch (error: any) {
    console.error(`[CANCEL BYPASS] Error:`, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
