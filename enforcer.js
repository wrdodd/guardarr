// Standalone enforcer script - bundled version with TV ratings support and rating normalization
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

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

// Build a Plex label filter clause from include/exclude labels.
// Plex restriction filters are "|"-joined clauses, e.g. contentRating=G,PG|label=kids.
function buildLabelClause(include, exclude) {
  const clauses = [];
  const inc = (include || "").split(",").map((s) => s.trim()).filter(Boolean);
  const exc = (exclude || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (inc.length) clauses.push(`label=${inc.join(",")}`);
  if (exc.length) clauses.push(`label!=${exc.join(",")}`);
  return clauses.join("|");
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

    const labelClause = buildLabelClause(rule.include_labels, rule.exclude_labels);
    const movieFilter = [buildFilter(effectiveMovieAllowed, effectiveMovieBlocked), labelClause].filter(Boolean).join("|");
    const tvFilter = [buildFilter(effectiveTvAllowed, effectiveTvBlocked), labelClause].filter(Boolean).join("|");

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
    if (rule.include_labels) parts.push(`Labels: ${rule.include_labels}`);
    if (rule.exclude_labels) parts.push(`Block labels: ${rule.exclude_labels}`);
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

// ───────────────────────── health status (surfaced in the UI) ─────────────────────────
function ensureStatusTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS enforcer_status (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_run DATETIME,
      last_success DATETIME,
      last_error TEXT,
      consecutive_failures INTEGER DEFAULT 0,
      token_valid INTEGER DEFAULT 1,
      last_backup_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try { db.prepare("INSERT INTO enforcer_status (id) VALUES (1)").run(); } catch (e) { /* exists */ }
}

function nowStr() { return new Date().toISOString().replace("T", " ").slice(0, 19); }

function setStatus(fields) {
  const cols = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) { cols.push(`${k} = ?`); vals.push(v); }
  cols.push("updated_at = datetime('now')");
  try {
    db.prepare(`UPDATE enforcer_status SET ${cols.join(", ")} WHERE id = 1`).run(...vals);
  } catch (e) {
    console.error("[ENFORCER] status write failed:", e.message);
  }
}

let consecutiveFailures = 0;
let lastValidate = 0;
let lastBackup = 0;

// Optional alert webhook (Discord/Slack/ntfy style) — fired on repeated failures.
async function sendAlert(message) {
  const url = getSetting("alert_webhook_url", "ALERT_WEBHOOK_URL");
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message, text: message }),
    });
    console.log("[ENFORCER] alert sent");
  } catch (e) {
    console.error("[ENFORCER] alert webhook failed:", e.message);
  }
}

// Proactively check the admin token against plex.tv and record validity.
async function validateToken() {
  const token = getSetting("plex_admin_token", "PLEX_ADMIN_TOKEN");
  if (!token) {
    setStatus({ token_valid: 0, last_error: "No Plex token configured" });
    console.error("[ENFORCER] No Plex token configured — set one in Settings.");
    return false;
  }
  try {
    const res = await fetch("https://plex.tv/api/v2/user", {
      headers: { "X-Plex-Token": token, Accept: "application/json" },
    });
    setStatus({ token_valid: res.ok ? 1 : 0 });
    if (!res.ok) {
      console.error(`[ENFORCER] Plex token INVALID (HTTP ${res.status}) — re-authenticate in Settings.`);
      if (consecutiveFailures === 0) sendAlert(`Guardarr: Plex admin token is invalid (HTTP ${res.status}). Re-authenticate in Settings.`);
    }
    return res.ok;
  } catch (e) {
    // Network blip — don't flag the token invalid on a transient error.
    console.error("[ENFORCER] token validation error:", e.message);
    return true;
  }
}

// Daily DB backup (online, safe) + WAL checkpoint, keeping the newest 7.
function backupDatabase() {
  try {
    const dir = path.join(path.dirname(dbPath), "backups");
    fs.mkdirSync(dir, { recursive: true });
    try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch (e) { /* best effort */ }
    const stamp = new Date().toISOString().slice(0, 10);
    const dest = path.join(dir, `guardarr-${stamp}.db`);
    db.backup(dest)
      .then(() => {
        const files = fs.readdirSync(dir)
          .filter((f) => f.startsWith("guardarr-") && f.endsWith(".db"))
          .sort();
        while (files.length > 7) {
          try { fs.unlinkSync(path.join(dir, files.shift())); } catch (e) { /* ignore */ }
        }
        setStatus({ last_backup_at: nowStr() });
        console.log(`[ENFORCER] DB backup written: ${dest}`);
      })
      .catch((e) => console.error("[ENFORCER] backup failed:", e.message));
  } catch (e) {
    console.error("[ENFORCER] backup error:", e.message);
  }
}

// ───────────────────────────────── enforce loop ─────────────────────────────────
async function enforceRules() {
  let failures = 0;
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
        if (success) appliedRules.add(ruleKey); else failures++;
      } else if (!shouldBeActive && isCurrentlyApplied) {
        const success = await removeRestrictions(rule.plex_id, rule.plex_username, rule.name);
        if (success) appliedRules.delete(ruleKey); else failures++;
      }
    }

    if (failures === 0) {
      consecutiveFailures = 0;
      setStatus({ last_run: nowStr(), last_success: nowStr(), consecutive_failures: 0, last_error: null });
    } else {
      consecutiveFailures++;
      setStatus({ last_run: nowStr(), consecutive_failures: consecutiveFailures, last_error: `${failures} apply/clear failure(s) — Plex token may be invalid` });
      if (consecutiveFailures === 3) {
        sendAlert(`Guardarr: enforcement failing (${failures} error(s) this run). The Plex admin token may be invalid — check Settings.`);
      }
    }
  } catch (error) {
    consecutiveFailures++;
    console.error("[ENFORCER] Error:", error.message);
    setStatus({ last_run: nowStr(), consecutive_failures: consecutiveFailures, last_error: error.message });
  }
}

// Self-scheduling loop: 60s normally, exponential backoff (capped 5 min) while failing,
// so a bad token doesn't hammer plex.tv every minute all day.
async function runCycle() {
  const now = Date.now();
  if (now - lastValidate > 5 * 60 * 1000) { lastValidate = now; await validateToken(); }
  if (now - lastBackup > 24 * 60 * 60 * 1000) { lastBackup = now; backupDatabase(); }

  await enforceRules();

  const base = 60 * 1000;
  const delay = consecutiveFailures > 0
    ? Math.min(base * Math.pow(2, consecutiveFailures), 5 * 60 * 1000)
    : base;
  setTimeout(runCycle, delay);
}

// Startup DB integrity check — surfaces corruption immediately (the DB is tiny).
function checkIntegrity() {
  try {
    const r = db.pragma("integrity_check");
    const ok = Array.isArray(r) && r[0] && r[0].integrity_check === "ok";
    if (ok) { console.log("[ENFORCER] DB integrity check: ok"); return; }
    const detail = JSON.stringify(r);
    console.error("[ENFORCER] DB INTEGRITY CHECK FAILED:", detail);
    setStatus({ last_error: "DB integrity check failed: " + detail });
    sendAlert("Guardarr: database integrity check FAILED on startup — consider restoring from data/backups/.");
  } catch (e) {
    console.error("[ENFORCER] integrity check error:", e.message);
  }
}

// ───────────────────────────────── startup ─────────────────────────────────
ensureStatusTable();
checkIntegrity();
console.log("[ENFORCER] Starting standalone enforcer...");
runCycle();

setInterval(() => {
  console.log("[ENFORCER] Heartbeat", new Date().toISOString());
}, 60000);
