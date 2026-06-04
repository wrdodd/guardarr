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

export function formatLocalTime(date: Date): string {
  const timezone = getTimezone();
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export function getLocalTime() {
  const timezone = getTimezone();
  const now = new Date();
  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    weekday: "short",
  });

  const parts = timeFormatter.formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0");
  const minute = parts.find((p) => p.type === "minute")?.value || "00";
  const weekday = parts.find((p) => p.type === "weekday")?.value?.toLowerCase() || "";

  const dayMap: Record<string, string> = {
    sun: "sun", mon: "mon", tue: "tue", wed: "wed", thu: "thu", fri: "fri", sat: "sat",
  };
  const currentDay = dayMap[weekday.substring(0, 3)] || weekday.substring(0, 3);
  const currentTime = `${String(hour).padStart(2, "0")}:${minute}`;

  return { currentDay, currentTime, timezone };
}
