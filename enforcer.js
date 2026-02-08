// Standalone enforcer script - bundled version with TV ratings support and rating normalization
const Database = require("better-sqlite3");
const path = require("path");

// Initialize database
const dbPath = process.env.DATABASE_URL || path.join(process.cwd(), "data", "guardarr.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

// Helper to get settings
function getSetting(key, envKey) {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
    return row?.value || process.env[envKey] || "";
  } catch {
    return process.env[envKey] || "";
  }
}

// Normalize rating names to handle Plex variations
function normalizeRating(rating) {
  const normalized = rating.trim();
  if (normalized === "NR" || normalized === "Not Rated") {
    return ["NR", "Not Rated"];
  }
  return [normalized];
}

// Build a Plex content rating filter string from allowed/blocked ratings
function buildFilter(allowed, blocked) {
  if (allowed) {
    const ratings = allowed.split(",").flatMap(r => normalizeRating(r)).filter(Boolean);
    const uniqueRatings = [...new Set(ratings)];
    if (uniqueRatings.length > 0) return `contentRating=${uniqueRatings.join(",")}`;
  } else if (blocked) {
    const ratings = blocked.split(",").flatMap(r => normalizeRating(r)).filter(Boolean);
    const uniqueRatings = [...new Set(ratings)];
    if (uniqueRatings.length > 0) return `contentRating!=${uniqueRatings.join(",")}`;
  }
  return "";
}

// Check if current time falls within rule time window
function isRuleActive(rule) {
  const now = new Date();
  const currentDay = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()];
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  
  const days = rule.days.split(',');
  if (!days.includes(currentDay) && !days.includes('all')) {
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
async function applyRestrictions(plexUserId, rule, username) {
  const token = getSetting("plex_admin_token", "PLEX_ADMIN_TOKEN");
  
  if (!token) {
    console.error("[ENFORCER] No Plex token configured");
    return false;
  }
  
  try {
    const movieBlocked = rule.blocked_ratings || '';
    const tvBlocked = rule.blocked_tv_ratings || '';
    const movieAllowed = rule.allowed_ratings || '';
    const tvAllowed = rule.allowed_tv_ratings || '';
    
    const hasTvMaBlocked = (movieBlocked + ',' + tvBlocked).split(',').some(r => r.trim() === "TV-MA");
    const hasTvMaAllowed = (movieAllowed + ',' + tvAllowed).split(',').some(r => r.trim() === "TV-MA");
    
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

    const params = new URLSearchParams();
    params.set('X-Plex-Token', token);
    if (movieFilter) params.set('filterMovies', movieFilter);
    if (tvFilter) params.set('filterTelevision', tvFilter);
    
    if (movieFilter || tvFilter) {
      const url = `https://plex.tv/api/users/${plexUserId}?${params.toString()}`;
      console.log(`[ENFORCER] Apply URL: ${url.replace(token, '***')}`);
      const res = await fetch(url, { method: 'PUT' });
      console.log(`[ENFORCER] Response: ${res.status} ${res.statusText}`);
      if (!res.ok) throw new Error(`Filter apply failed: ${res.status}`);
    }
    
    const parts = [];
    if (rule.allowed_ratings) parts.push(`Movies allowed: ${rule.allowed_ratings}`);
    else if (rule.blocked_ratings) parts.push(`Movies blocked: ${rule.blocked_ratings}`);
    if (rule.allowed_tv_ratings) parts.push(`TV allowed: ${rule.allowed_tv_ratings}`);
    else if (rule.blocked_tv_ratings) parts.push(`TV blocked: ${rule.blocked_tv_ratings}`);
    const restrictionDesc = parts.join(' | ') || 'No ratings configured';
    console.log(`[ENFORCER] Applied restrictions to ${username}: ${restrictionDesc}`);
    
    db.prepare(
      "INSERT INTO activity_log (plex_username, rule_name, action, details) VALUES (?, ?, ?, ?)"
    ).run(username, rule.name, "rule_applied", restrictionDesc);
    
    return true;
  } catch (error) {
    console.error(`[ENFORCER] Failed to apply to ${username}:`, error.message);
    return false;
  }
}

async function removeRestrictions(plexUserId, username, ruleName) {
  const token = getSetting("plex_admin_token", "PLEX_ADMIN_TOKEN");
  if (!token) return false;
  
  try {
    const clearUrl = `https://plex.tv/api/users/${plexUserId}?X-Plex-Token=${token}&filterMovies=&filterTelevision=`;
    const res = await fetch(clearUrl, { method: 'PUT' });
    if (!res.ok) throw new Error(`Clear failed: ${res.status}`);
    console.log(`[ENFORCER] Cleared restrictions from ${username}`);
    db.prepare(
      "INSERT INTO activity_log (plex_username, rule_name, action, details) VALUES (?, ?, ?, ?)"
    ).run(username, ruleName, "restriction_lifted", "Rule time window ended");
    return true;
  } catch (error) {
    console.error(`[ENFORCER] Failed to clear ${username}:`, error.message);
    return false;
  }
}

const appliedRules = new Set();

async function enforceRules() {
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
        const success = await applyRestrictions(rule.plex_id, rule, rule.plex_username);
        if (success) appliedRules.add(ruleKey);
      } else if (!shouldBeActive && isCurrentlyApplied) {
        const success = await removeRestrictions(rule.plex_id, rule.plex_username, rule.name);
        if (success) appliedRules.delete(ruleKey);
      }
    }
  } catch (error) {
    console.error("[ENFORCER] Error:", error.message);
  }
}

function startEnforcer(intervalMinutes = 1) {
  console.log(`[ENFORCER] Starting (checking every ${intervalMinutes} min)`);
  enforceRules();
  setInterval(enforceRules, intervalMinutes * 60000);
}

console.log("[ENFORCER] Starting standalone enforcer...");
startEnforcer(1);

setInterval(() => {
  console.log("[ENFORCER] Heartbeat", new Date().toISOString());
}, 60000);
