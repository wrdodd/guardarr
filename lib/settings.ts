import { db } from "@/lib/db";

// Environment variable fallback map (matches enforcer.js behavior)
const ENV_FALLBACK: Record<string, string> = {
  plex_admin_token: "PLEX_ADMIN_TOKEN",
  plex_server_url: "PLEX_SERVER_URL",
  timezone: "TIMEZONE",
};

/**
 * Get a setting from the database, with env var fallback.
 * This matches the enforcer.js getSetting behavior so tokens
 * stored as env vars (not in DB settings table) still work.
 */
export function getSetting(key: string): string | null {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    const dbVal = row?.value || null;
    if (dbVal) return dbVal;
  } catch {
    // DB error — fall through to env check
  }
  // Fallback to environment variable
  const envKey = ENV_FALLBACK[key];
  if (envKey && process.env[envKey]) {
    return process.env[envKey]!;
  }
  return null;
}

export function getTimezone(): string {
  return getSetting("timezone") || "America/Los_Angeles";
}

/** True if a Plex admin token is configured (DB or env) — without exposing its value. */
export function isAdminTokenConfigured(): boolean {
  return !!getSetting("plex_admin_token");
}

export interface EnforcerStatus {
  last_run: string | null;
  last_success: string | null;
  last_error: string | null;
  consecutive_failures: number;
  token_valid: number;
  last_backup_at: string | null;
  updated_at: string | null;
}

/** Read the enforcer's single-row health record (written by enforcer.js). */
export function getEnforcerStatus(): EnforcerStatus | null {
  try {
    const row = db
      .prepare("SELECT * FROM enforcer_status WHERE id = 1")
      .get() as EnforcerStatus | undefined;
    return row || null;
  } catch {
    return null;
  }
}

/**
 * Format an instant in the configured timezone.
 * `hour12` renders am/pm, which is what the dashboard and activity feed use.
 */
export function formatLocalTime(date: Date, opts?: { hour12?: boolean }): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: getTimezone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: opts?.hour12 ?? false,
  }).format(date);
}

/**
 * Current day/time in the configured timezone.
 * Delegates to lib/enforcement.js so the UI, the API routes and the standalone
 * enforcer all answer "what time is it" identically.
 */
export function getLocalTime() {
  const { getLocalTime: shared } = require("./enforcement.js");
  return shared(getTimezone()) as { currentDay: string; currentTime: string; timezone: string };
}
