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

// ───────────────────────── timezone-aware clock ─────────────────────────
// The schedule MUST be evaluated in the household's timezone, not the container's.
// This mirrors lib/settings.ts getLocalTime() so the UI, the bypass routes and this
// enforcer all agree on "what time is it".
//
// It deliberately does NOT depend on the container's TZ env var: a missing TZ is
// exactly what made every rule fire in UTC (7 hours early on Pacific) until
// 2026-09-14. TZ is still set on the container as belt-and-braces, but correctness
// now comes from settings.timezone.
function getTimezone() {
  return getSetting("timezone", "TIMEZONE") || "America/Los_Angeles";
}

function getLocalTime() {
  const timezone = getTimezone();
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
      weekday: "short",
    }).formatToParts(new Date());
    // en-US + hour12:false can yield hourCycle h24 ("24" at midnight) — fold to 00.
    const hour = parseInt(parts.find((x) => x.type === "hour")?.value || "0", 10) % 24;
    const minute = parts.find((x) => x.type === "minute")?.value || "00";
    const day = (parts.find((x) => x.type === "weekday")?.value || "").toLowerCase().slice(0, 3);
    return { currentDay: day, currentTime: `${String(hour).padStart(2, "0")}:${minute}`, timezone };
  } catch (e) {
    // Bad timezone string — fall back to container local so we still enforce something.
    console.error(`[ENFORCER] Invalid timezone "${timezone}" (${e.message}) — using container local time`);
    const now = new Date();
    return {
      currentDay: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][now.getDay()],
      currentTime: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
      timezone: "(container local)",
    };
  }
}

// Check if a rule's day/time window covers `clock` (from getLocalTime()).
function isRuleActive(rule, clock) {
  const { currentDay, currentTime } = clock;
  const days = (rule.days || "").split(",").map((d) => d.trim()).filter(Boolean);
  if (!days.includes(currentDay) && !days.includes("all")) return false;

  const start = rule.start_time;
  const end = rule.end_time;
  if (start <= end) return currentTime >= start && currentTime <= end;
  return currentTime >= start || currentTime <= end; // window crosses midnight
}

// Compute the exact Plex filter strings a rule wants. Factored out of
// applyRestrictions so that "what we would apply" and "what is live on Plex"
// are always compared as identical strings.
function buildDesiredFilters(rule) {
  const movieBlocked = rule.blocked_ratings || "";
  const tvBlocked = rule.blocked_tv_ratings || "";
  const movieAllowed = rule.allowed_ratings || "";
  const tvAllowed = rule.allowed_tv_ratings || "";

  const hasTvMaBlocked = (movieBlocked + "," + tvBlocked).split(",").some((r) => r.trim() === "TV-MA");
  const hasTvMaAllowed = (movieAllowed + "," + tvAllowed).split(",").some((r) => r.trim() === "TV-MA");

  let effectiveMovieBlocked = movieBlocked;
  let effectiveTvBlocked = tvBlocked;
  let effectiveMovieAllowed = movieAllowed;
  let effectiveTvAllowed = tvAllowed;

  if (hasTvMaBlocked) {
    if (!effectiveMovieBlocked.includes("TV-MA")) effectiveMovieBlocked = effectiveMovieBlocked ? effectiveMovieBlocked + ",TV-MA" : "TV-MA";
    if (!effectiveTvBlocked.includes("TV-MA")) effectiveTvBlocked = effectiveTvBlocked ? effectiveTvBlocked + ",TV-MA" : "TV-MA";
  }
  if (hasTvMaAllowed) {
    if (!effectiveMovieAllowed.includes("TV-MA")) effectiveMovieAllowed = effectiveMovieAllowed ? effectiveMovieAllowed + ",TV-MA" : "TV-MA";
    if (!effectiveTvAllowed.includes("TV-MA")) effectiveTvAllowed = effectiveTvAllowed ? effectiveTvAllowed + ",TV-MA" : "TV-MA";
  }

  const labelClause = buildLabelClause(rule.include_labels, rule.exclude_labels);
  return {
    movieFilter: [buildFilter(effectiveMovieAllowed, effectiveMovieBlocked), labelClause].filter(Boolean).join("|"),
    tvFilter: [buildFilter(effectiveTvAllowed, effectiveTvBlocked), labelClause].filter(Boolean).join("|"),
  };
}

// Apply restrictions to a Plex user via plex.tv API.
// `desired` comes from buildDesiredFilters(rule); `logActivity` is false for pure
// drift corrections so the activity feed only records real state changes.
async function applyRestrictions(plexUserId, rule, username, desired, logActivity) {
  const token = getSetting("plex_admin_token", "PLEX_ADMIN_TOKEN");

  if (!token) {
    console.error("[ENFORCER] No Plex token configured");
    return false;
  }

  try {
    const { movieFilter, tvFilter } = desired;
    if (!movieFilter && !tvFilter) {
      console.log(`[ENFORCER] Rule "${rule.name}" produces no filter — nothing to apply for ${username}`);
      return false;
    }

    const params = new URLSearchParams();
    params.set("X-Plex-Token", token);
    params.set("filterMovies", movieFilter);
    params.set("filterTelevision", tvFilter);

    const url = `https://plex.tv/api/users/${plexUserId}?${params.toString()}`;
    console.log(`[ENFORCER] Apply ${username}: movies="${movieFilter}" tv="${tvFilter}"`);
    const res = await fetch(url, { method: "PUT" });
    if (!res.ok) throw new Error(`Filter apply failed: ${res.status}`);

    const parts = [];
    if (rule.allowed_ratings) parts.push(`Movies allowed: ${rule.allowed_ratings}`);
    else if (rule.blocked_ratings) parts.push(`Movies blocked: ${rule.blocked_ratings}`);
    if (rule.allowed_tv_ratings) parts.push(`TV allowed: ${rule.allowed_tv_ratings}`);
    else if (rule.blocked_tv_ratings) parts.push(`TV blocked: ${rule.blocked_tv_ratings}`);
    if (rule.include_labels) parts.push(`Labels: ${rule.include_labels}`);
    if (rule.exclude_labels) parts.push(`Block labels: ${rule.exclude_labels}`);
    const restrictionDesc = parts.join(" | ") || "No ratings configured";
    console.log(`[ENFORCER] Applied restrictions to ${username}: ${restrictionDesc}`);

    if (logActivity) {
      db.prepare(
        "INSERT INTO activity_log (plex_username, rule_name, action, details) VALUES (?, ?, ?, ?)"
      ).run(username, rule.name, "rule_applied", restrictionDesc);
    }

    return true;
  } catch (error) {
    console.error(`[ENFORCER] Failed to apply to ${username}:`, error.message);
    return false;
  }
}

async function removeRestrictions(plexUserId, username, ruleName, reason) {
  const token = getSetting("plex_admin_token", "PLEX_ADMIN_TOKEN");
  if (!token) return false;

  try {
    const clearUrl = `https://plex.tv/api/users/${plexUserId}?X-Plex-Token=${token}&filterMovies=&filterTelevision=`;
    const res = await fetch(clearUrl, { method: 'PUT' });
    if (!res.ok) throw new Error(`Clear failed: ${res.status}`);
    console.log(`[ENFORCER] Cleared restrictions from ${username}`);
    db.prepare(
      "INSERT INTO activity_log (plex_username, rule_name, action, details) VALUES (?, ?, ?, ?)"
    ).run(username, ruleName, "restriction_lifted", reason || "Rule time window ended");
    return true;
  } catch (error) {
    console.error(`[ENFORCER] Failed to clear ${username}:`, error.message);
    return false;
  }
}

// ─────────────────── durable applied-state + live Plex reconciliation ───────────────────
// The old implementation tracked applied rules in an in-memory Set. That state died with
// the process: restart the container after a window had opened and the "window ended"
// branch could never fire, so the Plex filter was never cleared and the user stayed
// restricted forever (only a manual bypass/override cleared it). The applied_restrictions
// table already existed (the bypass routes maintain it) — the enforcer just ignored it.
//
// State now lives in the DB, and every cycle is additionally reconciled against the REAL
// filters on plex.tv, so the enforcer self-heals from restarts, restored backups and
// out-of-band edits instead of trusting process memory.

function ensureAppliedTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS applied_restrictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      rule_id INTEGER NOT NULL,
      plex_tv_id TEXT NOT NULL,
      username TEXT NOT NULL,
      rule_name TEXT NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, rule_id)
    )
  `);
  // Additive migration: remember exactly which filter strings we pushed, so a rule edit
  // is distinguishable from external drift.
  const cols = db.prepare("PRAGMA table_info(applied_restrictions)").all().map((c) => c.name);
  if (!cols.includes("movie_filter")) db.exec("ALTER TABLE applied_restrictions ADD COLUMN movie_filter TEXT");
  if (!cols.includes("tv_filter")) db.exec("ALTER TABLE applied_restrictions ADD COLUMN tv_filter TEXT");
}

function getAppliedByUser() {
  const map = new Map();
  for (const row of db.prepare("SELECT * FROM applied_restrictions").all()) map.set(row.user_id, row);
  return map;
}

function markApplied(userId, rule, plexTvId, username, desired) {
  try {
    db.prepare("DELETE FROM applied_restrictions WHERE user_id = ? AND rule_id != ?").run(userId, rule.id);
    db.prepare(`
      INSERT INTO applied_restrictions (user_id, rule_id, plex_tv_id, username, rule_name, movie_filter, tv_filter)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, rule_id) DO UPDATE SET
        applied_at = CURRENT_TIMESTAMP, plex_tv_id = excluded.plex_tv_id,
        username = excluded.username, rule_name = excluded.rule_name,
        movie_filter = excluded.movie_filter, tv_filter = excluded.tv_filter
    `).run(userId, rule.id, String(plexTvId), username, rule.name, desired.movieFilter, desired.tvFilter);
  } catch (e) {
    console.error("[ENFORCER] markApplied failed:", e.message);
  }
}

function clearApplied(userId) {
  try { db.prepare("DELETE FROM applied_restrictions WHERE user_id = ?").run(userId); }
  catch (e) { console.error("[ENFORCER] clearApplied failed:", e.message); }
}

// Users with an unexpired temporary bypass. expires_at is stored UTC by the bypass
// route, so compare against a UTC stamp.
function activeBypassUserIds() {
  try {
    const nowUtc = new Date().toISOString().replace("T", " ").slice(0, 19);
    return new Set(
      db.prepare("SELECT user_id FROM temporary_bypasses WHERE expires_at > ?").all(nowUtc).map((r) => r.user_id)
    );
  } catch (e) {
    console.error("[ENFORCER] bypass lookup failed:", e.message);
    return new Set(); // fail closed: enforce rather than silently leave users unrestricted
  }
}

// Plex echoes filter attributes back percent-encoded and XML-escaped; normalize so
// string comparison against our generated filters is meaningful.
function decodeAttr(v) {
  if (!v) return "";
  let out = v
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  try { out = decodeURIComponent(out); } catch (e) { /* stray % — use as-is */ }
  return out.trim();
}

// One call per cycle returns every shared/managed user's live filters — ground truth.
async function fetchLiveFilters(token) {
  const res = await fetch(`https://plex.tv/api/users?X-Plex-Token=${encodeURIComponent(token)}`);
  if (!res.ok) throw new Error(`users fetch ${res.status}`);
  const xml = await res.text();
  const map = new Map();
  for (const m of xml.matchAll(/<User\b[^>]*>/g)) {
    const tag = m[0];
    const id = (tag.match(/\bid="(\d+)"/) || [])[1];
    if (!id) continue;
    map.set(id, {
      movies: decodeAttr((tag.match(/\bfilterMovies="([^"]*)"/) || [, ""])[1]),
      tv: decodeAttr((tag.match(/\bfilterTelevision="([^"]*)"/) || [, ""])[1]),
    });
  }
  return map;
}

// Does a live filter look like something WE set? Used to adopt/clear orphans left by an
// older build without stomping filters an admin set by hand in Plex.
function looksLikeOurs(liveState, userRules) {
  return userRules.some((r) => {
    const d = buildDesiredFilters(r);
    return (d.movieFilter && liveState.movies === d.movieFilter) ||
           (d.tvFilter && liveState.tv === d.tvFilter);
  });
}

const warnedForeign = new Set();


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

// Weekly digest to the alert webhook (opt-in: requires alert_webhook_url).
function maybeSendDigest() {
  const webhook = getSetting("alert_webhook_url", "ALERT_WEBHOOK_URL");
  if (!webhook) return;
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key='last_digest_at'").get();
    if (!row || !row.value) {
      db.prepare("INSERT INTO settings(key,value,updated_at) VALUES('last_digest_at',datetime('now'),datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").run();
      return;
    }
    const due = db.prepare("SELECT (julianday('now') - julianday(value)) >= 7 AS due FROM settings WHERE key='last_digest_at'").get();
    if (!due || !due.due) return;
    const q = (sql) => db.prepare(sql).get().n;
    const total = q("SELECT COUNT(*) n FROM activity_log WHERE created_at >= datetime('now','-7 days')");
    const applies = q("SELECT COUNT(*) n FROM activity_log WHERE action='rule_applied' AND created_at >= datetime('now','-7 days')");
    const bypasses = q("SELECT COUNT(*) n FROM activity_log WHERE action LIKE 'bypass%' AND created_at >= datetime('now','-7 days')");
    const users = q("SELECT COUNT(*) n FROM users WHERE deactivated=0 AND is_admin=0");
    const tv = db.prepare("SELECT token_valid FROM enforcer_status WHERE id=1").get();
    const health = tv && tv.token_valid ? "healthy" : "FAILING — check the Plex token";
    const msg = `Guardarr weekly digest — last 7 days: ${total} events, ${applies} rule applies, ${bypasses} bypass actions, across ${users} managed/shared users. Enforcement is ${health}.`;
    fetch(webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: msg, text: msg }) })
      .then(() => console.log("[ENFORCER] weekly digest sent"))
      .catch((e) => console.error("[ENFORCER] digest send failed:", e.message));
    db.prepare("UPDATE settings SET value=datetime('now'), updated_at=datetime('now') WHERE key='last_digest_at'").run();
  } catch (e) {
    console.error("[ENFORCER] digest error:", e.message);
  }
}

// ───────────────────────────────── enforce loop ─────────────────────────────────
async function enforceRules() {
  let failures = 0;
  const clock = getLocalTime();
  try {
    const rows = db.prepare(`
      SELECT r.*, u.plex_id, u.plex_username, u.id as user_db_id
      FROM rules r
      JOIN user_rules ur ON r.id = ur.rule_id
      JOIN users u ON u.id = ur.user_id
      WHERE r.is_active = 1 AND u.deactivated = 0
    `).all();

    // Plex holds ONE filter per user, so a user with several matching rules needs a
    // single winner. Highest priority wins, ties broken by lowest rule id — previously
    // whichever rule happened to be iterated last silently won.
    const byUser = new Map();
    for (const row of rows) {
      if (!byUser.has(row.user_db_id)) byUser.set(row.user_db_id, []);
      byUser.get(row.user_db_id).push(row);
    }
    if (byUser.size === 0) {
      setStatus({ last_run: nowStr(), last_success: nowStr(), consecutive_failures: 0, last_error: null });
      consecutiveFailures = 0;
      return;
    }

    const token = getSetting("plex_admin_token", "PLEX_ADMIN_TOKEN");
    let live = null;
    if (token) {
      try {
        live = await fetchLiveFilters(token);
      } catch (e) {
        // Non-fatal: fall back to DB-recorded state for this cycle.
        console.error("[ENFORCER] live filter fetch failed, using recorded state:", e.message);
      }
    }

    const bypassed = activeBypassUserIds();
    const appliedByUser = getAppliedByUser();

    for (const [userId, userRules] of byUser) {
      const u = userRules[0];
      const applied = appliedByUser.get(userId) || null;
      const liveState = live ? (live.get(String(u.plex_id)) || { movies: "", tv: "" }) : null;
      const liveHasFilter = liveState ? !!(liveState.movies || liveState.tv) : null;

      // A temporary bypass outranks every rule: ensure the user is clear and never
      // re-apply while it is in force. (The old code only honoured bypasses by accident
      // — its in-memory Set said "already applied", so it never re-fired. A restart
      // during a bypass silently re-restricted the user.)
      if (bypassed.has(userId)) {
        if (applied || liveHasFilter) {
          const ok = await removeRestrictions(u.plex_id, u.plex_username,
            applied ? applied.rule_name : "bypass", "Temporary bypass active");
          if (ok) clearApplied(userId); else failures++;
        }
        continue;
      }

      const active = userRules
        .filter((r) => isRuleActive(r, clock))
        .sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.id - b.id);
      const winner = active[0] || null;

      if (winner) {
        const desired = buildDesiredFilters(winner);
        const ruleChanged = !applied || applied.rule_id !== winner.id ||
          applied.movie_filter !== desired.movieFilter || applied.tv_filter !== desired.tvFilter;
        const driftsFromLive = liveState
          ? (liveState.movies !== desired.movieFilter || liveState.tv !== desired.tvFilter)
          : false;

        if (ruleChanged || driftsFromLive) {
          if (!ruleChanged && driftsFromLive) {
            console.log(`[ENFORCER] ${u.plex_username}: live filter drifted from rule "${winner.name}" — re-applying`);
          }
          // Only log to the activity feed on a real state change, not drift repair.
          const ok = await applyRestrictions(u.plex_id, winner, u.plex_username, desired, ruleChanged);
          if (ok) markApplied(userId, winner, u.plex_id, u.plex_username, desired);
          else failures++;
        } else if (!applied) {
          // Live already matches and there is no record (e.g. post-restart) — adopt it.
          markApplied(userId, winner, u.plex_id, u.plex_username, desired);
        }
        continue;
      }

      // No rule should be active → the user must end up unrestricted.
      if (liveHasFilter === false) {
        if (applied) clearApplied(userId); // already clear on Plex; drop the stale row
      } else if (applied || (liveState && looksLikeOurs(liveState, userRules))) {
        const ok = await removeRestrictions(u.plex_id, u.plex_username,
          applied ? applied.rule_name : "(recovered)", "Rule time window ended");
        if (ok) clearApplied(userId); else failures++;
      } else if (liveHasFilter && !warnedForeign.has(userId)) {
        // A filter we did not set and that matches none of this user's rules — leave it
        // alone rather than clobbering a manual Plex setting.
        warnedForeign.add(userId);
        console.warn(`[ENFORCER] ${u.plex_username} has a Plex filter Guardarr did not set (movies="${liveState.movies}" tv="${liveState.tv}") — leaving it untouched`);
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
  maybeSendDigest();

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
ensureAppliedTable();
checkIntegrity();
{
  const c = getLocalTime();
  console.log(`[ENFORCER] Starting standalone enforcer... local time ${c.currentDay} ${c.currentTime} (${c.timezone})`);
}
runCycle();

setInterval(() => {
  console.log("[ENFORCER] Heartbeat", new Date().toISOString());
}, 60000);
