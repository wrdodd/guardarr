import Database from 'better-sqlite3';
import { join } from 'path';

// Avoid database operations during build time
const isBuild = process.env.NODE_ENV === 'production' && typeof window === 'undefined' && process.env.NEXT_PHASE === 'phase-production-build';

let dbInstance: Database.Database | null = null;

function getDbPath(): string {
  return process.env.DATABASE_URL || join(process.cwd(), 'data', 'guardarr.db');
}

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;
  
  const dbPath = getDbPath();
  dbInstance = new Database(dbPath);
  dbInstance.pragma('journal_mode = WAL');
  return dbInstance;
}

// Export db for backwards compatibility - lazy init
export const db = new Proxy({} as Database.Database, {
  get(target, prop) {
    const db = getDb();
    const value = (db as any)[prop];
    return typeof value === 'function' ? value.bind(db) : value;
  }
});

// Initialize schema
export function initDatabase() {
  if (isBuild) return; // Skip during build
  
  const db = getDb();
  
  // Settings table (key-value store for app config)
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Users table (Plex users synced from server)
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plex_id TEXT UNIQUE NOT NULL,
      plex_username TEXT NOT NULL,
      plex_email TEXT,
      plex_thumb TEXT,
      is_admin BOOLEAN DEFAULT 0,
      is_home BOOLEAN DEFAULT 0,
      is_restricted BOOLEAN DEFAULT 0,
      deactivated BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Add deactivated column if it doesn't exist (migration for existing DBs)
  try {
    db.exec(`ALTER TABLE users ADD COLUMN deactivated BOOLEAN DEFAULT 0`);
  } catch (e) {
    // Column already exists, ignore
  }

  // Rules table
  db.exec(`
    CREATE TABLE IF NOT EXISTS rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      is_active BOOLEAN DEFAULT 1,
      days TEXT NOT NULL DEFAULT 'mon,tue,wed,thu,fri,sat,sun',
      start_time TEXT NOT NULL DEFAULT '00:00',
      end_time TEXT NOT NULL DEFAULT '23:59',
      allowed_ratings TEXT DEFAULT '',
      blocked_ratings TEXT DEFAULT '',
      include_labels TEXT DEFAULT '',
      exclude_labels TEXT DEFAULT '',
      priority INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Add priority column if it doesn't exist (migration for existing DBs)
  try {
    db.exec(`ALTER TABLE rules ADD COLUMN priority INTEGER DEFAULT 0`);
  } catch (e) {
    // Column already exists, ignore
  }

  // Add TV rating columns if they don't exist (migration for existing DBs)
  try {
    db.exec(`ALTER TABLE rules ADD COLUMN allowed_tv_ratings TEXT DEFAULT ''`);
  } catch (e) {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE rules ADD COLUMN blocked_tv_ratings TEXT DEFAULT ''`);
  } catch (e) {
    // Column already exists, ignore
  }

  // User-rule assignments (many-to-many)
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      rule_id INTEGER NOT NULL,
      assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (rule_id) REFERENCES rules(id) ON DELETE CASCADE,
      UNIQUE(user_id, rule_id)
    )
  `);

  // Activity log
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plex_username TEXT,
      rule_name TEXT,
      action TEXT NOT NULL,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // User theme preferences
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      accent_color TEXT DEFAULT '#f97316',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Temporary bypasses
  db.exec(`
    CREATE TABLE IF NOT EXISTS temporary_bypasses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      minutes INTEGER NOT NULL,
      expires_at DATETIME NOT NULL,
      created_by TEXT DEFAULT 'admin',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Applied restrictions (for enforcer persistence across restarts)
  db.exec(`
    CREATE TABLE IF NOT EXISTS applied_restrictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      rule_id INTEGER NOT NULL,
      plex_tv_id TEXT NOT NULL,
      username TEXT NOT NULL,
      rule_name TEXT NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (rule_id) REFERENCES rules(id) ON DELETE CASCADE,
      UNIQUE(user_id, rule_id)
    )
  `);
}

// Initialize on module load (but not during build)
if (!isBuild) {
  initDatabase();
}
