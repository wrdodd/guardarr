import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getLocalTime } from "@/lib/settings";

interface RuleRow {
  id: number;
  name: string;
  is_active: number;
  days: string;
  start_time: string;
  end_time: string;
  allowed_ratings: string;
  blocked_ratings: string;
  allowed_tv_ratings: string;
  blocked_tv_ratings: string;
  priority: number;
  user_db_id: number;
  plex_username: string;
  plex_thumb: string | null;
  is_home: number;
  is_admin: number;
}

// Calculate minutes remaining until rule end time (accounting for overnight rules)
function minutesRemaining(endTime: string, currentTime: string): number {
  const [endH, endM] = endTime.split(":").map(Number);
  const [curH, curM] = currentTime.split(":").map(Number);
  let endMin = endH * 60 + endM;
  const curMin = curH * 60 + curM;

  // If end is before current (overnight rule), add 24 hours
  if (endMin <= curMin) {
    endMin += 24 * 60;
  }

  return endMin - curMin;
}

// GET /api/active-restrictions — return currently active restrictions with time remaining
export async function GET() {
  try {
    const { currentDay, currentTime } = getLocalTime();

    const rows = db.prepare(`
      SELECT r.id, r.name, r.is_active, r.days, r.start_time, r.end_time, 
             r.allowed_ratings, r.blocked_ratings,
             COALESCE(r.allowed_tv_ratings, '') as allowed_tv_ratings,
             COALESCE(r.blocked_tv_ratings, '') as blocked_tv_ratings,
             COALESCE(r.priority, 0) as priority,
             u.id as user_db_id, u.plex_username, u.plex_thumb, u.is_home, u.is_admin
      FROM rules r
      JOIN user_rules ur ON r.id = ur.rule_id
      JOIN users u ON u.id = ur.user_id
      WHERE r.is_active = 1
    `).all() as RuleRow[];

    const activeRestrictions = [];

    for (const row of rows) {
      // Check if rule is active now
      const ruleDays = row.days.split(",");
      if (!ruleDays.includes(currentDay) && !ruleDays.includes("all")) continue;

      const start = row.start_time;
      const end = row.end_time;
      let isActive = false;

      if (start <= end) {
        isActive = currentTime >= start && currentTime <= end;
      } else {
        isActive = currentTime >= start || currentTime <= end;
      }

      if (!isActive) continue;

      // Check if user has active bypass
      let hasBypass = false;
      try {
        const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
        const bypass = db.prepare(
          "SELECT * FROM temporary_bypasses WHERE user_id = ? AND expires_at > ?"
        ).get(row.user_db_id, now) as any;
        hasBypass = !!bypass;
      } catch {
        // Table might not exist yet
      }

      activeRestrictions.push({
        userId: row.user_db_id,
        username: row.plex_username,
        thumb: row.plex_thumb,
        isHome: row.is_home,
        isAdmin: row.is_admin,
        ruleId: row.id,
        ruleName: row.name,
        allowedRatings: row.allowed_ratings,
        blockedRatings: row.blocked_ratings,
        allowedTvRatings: row.allowed_tv_ratings,
        blockedTvRatings: row.blocked_tv_ratings,
        startTime: row.start_time,
        endTime: row.end_time,
        minutesRemaining: minutesRemaining(end, currentTime),
        priority: row.priority,
        hasBypass,
      });
    }

    // Sort by username then rule priority (desc)
    activeRestrictions.sort((a, b) => {
      if (a.username !== b.username) return a.username.localeCompare(b.username);
      return b.priority - a.priority;
    });

    return NextResponse.json({
      restrictions: activeRestrictions,
      currentTime,
      currentDay,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
