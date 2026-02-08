import { db } from "./db";

// Helper to get settings
function getSetting(key: string, envKey: string): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value || process.env[envKey] || "";
}

// Normalize rating names to handle Plex variations
function normalizeRating(rating: string): string[] {
  const normalized = rating.trim();
  // NR and Not Rated are the same in Plex
  if (normalized === "NR") return ["NR", "Not Rated"];
  if (normalized === "Not Rated") return ["NR", "Not Rated"];
  return [normalized];
}

// Build a Plex content rating filter string from allowed/blocked ratings
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

// Check if current time falls within rule time window
export function isRuleActive(rule: any): boolean {
  const now = new Date();
  const currentDay = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][now.getDay()];
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  
  const days = rule.days.split(",");
  if (!days.includes(currentDay) && !days.includes("all")) {
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

// Apply restrictions to a Plex user via plex.tv API
export async function applyRestrictions(plexUserId: string, rule: any, username: string) {
  const token = getSetting("plex_admin_token", "PLEX_ADMIN_TOKEN");
  
  if (!token) {
    console.error("[ENFORCER] No Plex token configured");
    return false;
  }
  
  try {
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
    
    if (movieFilter) {
      console.log(`[ENFORCER] Movie filter: ${movieFilter}`);
    }
    if (tvFilter) {
      console.log(`[ENFORCER] TV filter: ${tvFilter}`);
    }

    // Build a single PUT request with both filterMovies and filterTelevision
    const params = new URLSearchParams();
    params.set("X-Plex-Token", token);
    if (movieFilter) params.set("filterMovies", movieFilter);
    if (tvFilter) params.set("filterTelevision", tvFilter);
    
    if (movieFilter || tvFilter) {
      const url = `https://plex.tv/api/users/${plexUserId}?${params.toString()}`;
      console.log(`[ENFORCER] Apply URL: ${url.replace(token, "***")}`);
      const res = await fetch(url, { method: "PUT" });
      console.log(`[ENFORCER] Response: ${res.status} ${res.statusText}`);
      if (!res.ok) throw new Error(`Filter apply failed: ${res.status}`);
    }
    
    const parts: string[] = [];
    if (rule.allowed_ratings) parts.push(`Movies allowed: ${rule.allowed_ratings}`);
    else if (rule.blocked_ratings) parts.push(`Movies blocked: ${rule.blocked_ratings}`);
    if (rule.allowed_tv_ratings) parts.push(`TV allowed: ${rule.allowed_tv_ratings}`);
    else if (rule.blocked_tv_ratings) parts.push(`TV blocked: ${rule.blocked_tv_ratings}`);
    const restrictionDesc = parts.join(" | ") || "No ratings configured";
    console.log(`[ENFORCER] Applied restrictions to ${username}: ${restrictionDesc}`);
    
    // Log the action
    db.prepare(
      "INSERT INTO activity_log (plex_username, rule_name, action, details) VALUES (?, ?, ?, ?)"
    ).run(username, rule.name, "rule_applied", restrictionDesc);
    
    return true;
  } catch (error: any) {
    console.error(`[ENFORCER] Failed to apply to ${username}:`, error.message);
    return false;
  }
}

// Remove restrictions (clear filters)
export async function removeRestrictions(plexUserId: string, username: string, ruleName: string) {
  const token = getSetting("plex_admin_token", "PLEX_ADMIN_TOKEN");
  
  if (!token) return false;
  
  try {
    // Clear by setting empty filter or allowing all
    const clearUrl = `https://plex.tv/api/users/${plexUserId}?X-Plex-Token=${token}&filterMovies=&filterTelevision=`;
    const res = await fetch(clearUrl, { method: "PUT" });
    
    if (!res.ok) throw new Error(`Clear failed: ${res.status}`);
    
    console.log(`[ENFORCER] Cleared restrictions from ${username}`);
    
    db.prepare(
      "INSERT INTO activity_log (plex_username, rule_name, action, details) VALUES (?, ?, ?, ?)"
    ).run(username, ruleName, "restriction_lifted", "Rule time window ended");
    
    return true;
  } catch (error: any) {
    console.error(`[ENFORCER] Failed to clear ${username}:`, error.message);
    return false;
  }
}

// Track which rules are currently applied
const appliedRules = new Set<string>();

// Main enforcement loop
export async function enforceRules() {
  try {
    const activeRules = db.prepare(`
      SELECT r.*, u.plex_id, u.plex_username, u.id as user_db_id
      FROM rules r
      JOIN user_rules ur ON r.id = ur.rule_id
      JOIN users u ON u.id = ur.user_id
      WHERE r.is_active = 1
    `).all();
    
    for (const rule of activeRules) {
      const shouldBeActive = isRuleActive(rule);
      const ruleKey = `${rule.id}-${rule.user_db_id}`;
      const isCurrentlyApplied = appliedRules.has(ruleKey);
      
      if (shouldBeActive && !isCurrentlyApplied) {
        // Rule should be active and isn"t applied yet
        const success = await applyRestrictions(rule.plex_id, rule, rule.plex_username);
        if (success) {
          appliedRules.add(ruleKey);
        }
      } else if (!shouldBeActive && isCurrentlyApplied) {
        // Rule time window ended, remove restrictions
        const success = await removeRestrictions(rule.plex_id, rule.plex_username, rule.name);
        if (success) {
          appliedRules.delete(ruleKey);
        }
      }
    }
  } catch (error: any) {
    console.error("[ENFORCER] Error:", error.message);
  }
}

// Start the enforcer
export function startEnforcer(intervalMinutes: number = 1) {
  console.log(`[ENFORCER] Starting (checking every ${intervalMinutes} min)`);
  enforceRules();
  setInterval(enforceRules, intervalMinutes * 60000);
}
