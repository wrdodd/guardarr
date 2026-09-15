import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSetting, getTimezone, formatLocalTime, getLocalTime } from "@/lib/settings";
import { createHash } from "crypto";

// Plex writes and filter construction come from the shared enforcement core
// (lib/enforcement.js + lib/plex-api.js). This route previously carried its own
// older copies of buildFilter/applyPlexRestrictions that lacked rating
// normalization, the TV-MA cross-apply and label clauses — so cancelling a bypass
// re-applied a subtly DIFFERENT filter than the enforcer would, which the reconcile
// loop then corrected a minute later.
const { buildDesiredFilters, describeRule, isRuleActive } = require("@/lib/enforcement.js");
const { putUserFilters, clearUserFilters } = require("@/lib/plex-api.js");

async function removePlexRestrictions(plexUserId: string, token: string): Promise<boolean> {
  try {
    console.log(`[PLEX API] Removing restrictions for plex user ${plexUserId}`);
    await clearUserFilters(plexUserId, token);
    return true;
  } catch (err: any) {
    console.error(`[PLEX API] Remove restrictions error:`, err.message);
    return false;
  }
}

async function applyPlexRestrictions(plexUserId: string, rule: any, token: string): Promise<boolean> {
  try {
    const desired = buildDesiredFilters(rule);
    if (!desired.movieFilter && !desired.tvFilter) {
      console.log(`[PLEX API] No filter to apply for rule "${rule.name}" — skipping`);
      return false;
    }
    console.log(`[PLEX API] Applying restriction for plex user ${plexUserId}: movies=${desired.movieFilter} tv=${desired.tvFilter}`);
    await putUserFilters(plexUserId, token, desired.movieFilter, desired.tvFilter);
    return true;
  } catch (err: any) {
    console.error(`[PLEX API] Apply restrictions error:`, err.message);
    return false;
  }
}

// POST /api/users/[id]/bypass - create a temporary bypass
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const startTime = Date.now();
  try {
    console.log(`[GRANT BYPASS] === START === user_id=${params.id} at ${new Date().toISOString()}`);
    const body = await request.json();
    const { minutes, pin } = body;

    // Parent PIN gate (if configured) — blocks granting a bypass without the PIN.
    const pinRow = db.prepare("SELECT value FROM settings WHERE key = 'bypass_pin_hash'").get() as { value: string } | undefined;
    if (pinRow?.value) {
      const provided = createHash("sha256").update(String(pin ?? "")).digest("hex");
      if (provided !== pinRow.value) {
        return NextResponse.json({ error: "Incorrect or missing bypass PIN", pinRequired: true }, { status: 403 });
      }
    }

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
        // Shared schedule evaluation — identical to what the enforcer uses.
        const shouldBeActive = isRuleActive(rule, { currentDay, currentTime });
        console.log(`[CANCEL BYPASS] Rule "${rule.name}": active=${shouldBeActive}`);

        if (shouldBeActive) {
          // Apply restriction immediately — pass full rule object to handle both allowed/blocked ratings
          const success = await applyPlexRestrictions(plexTvId, rule, token);
          console.log(`[CANCEL BYPASS] Apply rule "${rule.name}" result: ${success}`);
          
          if (success) {
            appliedCount++;
            // Add to applied_restrictions so enforcer knows it's active
            const desired = buildDesiredFilters(rule);
            db.prepare(`
              INSERT INTO applied_restrictions (user_id, rule_id, plex_tv_id, username, rule_name, movie_filter, tv_filter)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(user_id, rule_id) DO UPDATE SET
                applied_at = CURRENT_TIMESTAMP,
                movie_filter = excluded.movie_filter,
                tv_filter = excluded.tv_filter
            `).run(params.id, rule.id, plexTvId, user.plex_username, rule.name, desired.movieFilter, desired.tvFilter);

            // Log the re-application
            const ratingInfo = describeRule(rule);
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
