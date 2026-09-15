// Standalone enforcer — evaluates rule schedules and reconciles Plex restrictions.
//
// Filter construction, schedule evaluation and the reconcile decision live in
// lib/enforcement.js so this process and the Next.js API routes share one
// implementation; plex.tv access lives in lib/plex-api.js. This file is the I/O
// shell: read state, ask for a decision, perform it, record the result.
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const { migrate } = require("./lib/migrations.js");
const {
  buildDesiredFilters, describeRule, getLocalTime, planUserAction,
} = require("./lib/enforcement.js");
const { fetchUsers, putUserFilters, clearUserFilters } = require("./lib/plex-api.js");

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

function getToken() {
  return getSetting("plex_admin_token", "PLEX_ADMIN_TOKEN");
}

function clock() {
  return getLocalTime(getSetting("timezone", "TIMEZONE"));
}

// ───────────────────────── Plex writes + activity logging ─────────────────────────

async function applyRestrictions(plexUserId, rule, username, desired, logActivity) {
  const token = getToken();
  if (!token) {
    console.error("[ENFORCER] No Plex token configured");
    return false;
  }
  if (!desired.movieFilter && !desired.tvFilter) {
    console.log(`[ENFORCER] Rule "${rule.name}" produces no filter — nothing to apply for ${username}`);
    return false;
  }
  try {
    console.log(`[ENFORCER] Apply ${username}: movies="${desired.movieFilter}" tv="${desired.tvFilter}"`);
    await putUserFilters(plexUserId, token, desired.movieFilter, desired.tvFilter);
    const detail = describeRule(rule);
    console.log(`[ENFORCER] Applied restrictions to ${username}: ${detail}`);
    if (logActivity) {
      db.prepare("INSERT INTO activity_log (plex_username, rule_name, action, details) VALUES (?, ?, ?, ?)")
        .run(username, rule.name, "rule_applied", detail);
    }
    return true;
  } catch (error) {
    console.error(`[ENFORCER] Failed to apply to ${username}:`, error.message);
    return false;
  }
}

async function removeRestrictions(plexUserId, username, ruleName, reason) {
  const token = getToken();
  if (!token) return false;
  try {
    await clearUserFilters(plexUserId, token);
    console.log(`[ENFORCER] Cleared restrictions from ${username}`);
    db.prepare("INSERT INTO activity_log (plex_username, rule_name, action, details) VALUES (?, ?, ?, ?)")
      .run(username, ruleName, "restriction_lifted", reason || "Rule time window ended");
    return true;
  } catch (error) {
    console.error(`[ENFORCER] Failed to clear ${username}:`, error.message);
    return false;
  }
}

// ─────────────────── durable applied-state ───────────────────
// State lives in the DB, never in process memory: an in-memory Set died with the
// process, so a restart after a window opened meant the "window ended" branch could
// never fire and the user stayed restricted indefinitely.

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

// Users with an unexpired bypass. expires_at is written UTC by the bypass route.
function activeBypassUserIds() {
  try {
    const nowUtc = new Date().toISOString().replace("T", " ").slice(0, 19);
    return new Set(
      db.prepare("SELECT user_id FROM temporary_bypasses WHERE expires_at > ?").all(nowUtc).map((r) => r.user_id)
    );
  } catch (e) {
    console.error("[ENFORCER] bypass lookup failed:", e.message);
    return new Set(); // fail closed: enforce rather than leave users unrestricted
  }
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
  const now = clock();
  try {
    const rows = db.prepare(`
      SELECT r.*, u.plex_id, u.plex_username, u.id as user_db_id
      FROM rules r
      JOIN user_rules ur ON r.id = ur.rule_id
      JOIN users u ON u.id = ur.user_id
      WHERE r.is_active = 1 AND u.deactivated = 0
    `).all();

    const byUser = new Map();
    for (const row of rows) {
      if (!byUser.has(row.user_db_id)) byUser.set(row.user_db_id, []);
      byUser.get(row.user_db_id).push(row);
    }
    if (byUser.size === 0) {
      consecutiveFailures = 0;
      setStatus({ last_run: nowStr(), last_success: nowStr(), consecutive_failures: 0, last_error: null });
      return;
    }

    // Ground truth: one call returns every managed user's live filters. If plex.tv
    // is unreachable we fall back to the DB record rather than guessing.
    const token = getToken();
    let live = null;
    if (token) {
      try { live = await fetchUsers(token); }
      catch (e) { console.error("[ENFORCER] live filter fetch failed, using recorded state:", e.message); }
    }

    const bypassed = activeBypassUserIds();
    const appliedByUser = getAppliedByUser();

    for (const [userId, userRules] of byUser) {
      const u = userRules[0];
      const action = planUserAction({
        rules: userRules,
        clock: now,
        applied: appliedByUser.get(userId) || null,
        liveState: live ? (live.get(String(u.plex_id)) || { movies: "", tv: "" }) : null,
        hasBypass: bypassed.has(userId),
      });

      switch (action.type) {
        case "apply": {
          if (action.drift) {
            console.log(`[ENFORCER] ${u.plex_username}: live filter drifted from rule "${action.rule.name}" — re-applying`);
          }
          const okApply = await applyRestrictions(u.plex_id, action.rule, u.plex_username, action.desired, action.logActivity);
          if (okApply) markApplied(userId, action.rule, u.plex_id, u.plex_username, action.desired);
          else failures++;
          break;
        }
        case "clear": {
          const okClear = await removeRestrictions(u.plex_id, u.plex_username, action.ruleName, action.reason);
          if (okClear) clearApplied(userId); else failures++;
          break;
        }
        case "adopt":
          // Live already matches the rule but no record exists (e.g. after a restart).
          markApplied(userId, action.rule, u.plex_id, u.plex_username, action.desired);
          break;
        case "forget":
          clearApplied(userId);
          break;
        case "foreign":
          if (!warnedForeign.has(userId)) {
            warnedForeign.add(userId);
            const ls = live ? live.get(String(u.plex_id)) : null;
            console.warn(`[ENFORCER] ${u.plex_username} has a Plex filter Guardarr did not set (movies="${ls?.movies}" tv="${ls?.tv}") — leaving it untouched`);
          }
          break;
        default:
          break;
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

// Activity log grows without bound. Prune alongside the daily backup.
// 0 disables pruning.
function pruneActivityLog() {
  try {
    const days = parseInt(getSetting("activity_retention_days", "ACTIVITY_RETENTION_DAYS") || "90", 10);
    if (!Number.isFinite(days) || days <= 0) return;
    const res = db.prepare("DELETE FROM activity_log WHERE created_at < datetime('now', ?)").run(`-${days} days`);
    if (res.changes > 0) console.log(`[ENFORCER] Pruned ${res.changes} activity entries older than ${days} days`);
  } catch (e) {
    console.error("[ENFORCER] activity prune failed:", e.message);
  }
}

// Self-scheduling loop: 60s normally, exponential backoff (capped 5 min) while failing,
// so a bad token doesn't hammer plex.tv every minute all day.
async function runCycle() {
  const now = Date.now();
  if (now - lastValidate > 5 * 60 * 1000) { lastValidate = now; await validateToken(); }
  if (now - lastBackup > 24 * 60 * 60 * 1000) { lastBackup = now; backupDatabase(); pruneActivityLog(); }
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
migrate(db, (m) => console.log(m));
ensureStatusTable();
checkIntegrity();
{
  const c = clock();
  if (c.invalidTimezone) {
    console.error(`[ENFORCER] Invalid timezone "${c.invalidTimezone}" — falling back to host local time`);
  }
  console.log(`[ENFORCER] Starting standalone enforcer... local time ${c.currentDay} ${c.currentTime} (${c.timezone})`);
}
runCycle();

setInterval(() => {
  console.log("[ENFORCER] Heartbeat", new Date().toISOString());
}, 60000);
