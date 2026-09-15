/**
 * Versioned schema migrations.
 *
 * Replaces ad-hoc `try { ALTER TABLE … } catch {}` blocks and PRAGMA table_info
 * probes that were scattered across lib/db.ts and enforcer.js. Two processes
 * (Next.js and the standalone enforcer) start concurrently and previously raced to
 * create the same tables; migrations now run once, in order, inside a transaction,
 * with the applied version recorded.
 *
 * Adding a migration: append to MIGRATIONS. Never edit or reorder an existing one —
 * deployed databases have already applied it.
 */

const MIGRATIONS = [
  {
    version: 1,
    name: "baseline",
    // Baseline reflects the schema as shipped through v1.1.13. Everything is
    // IF NOT EXISTS so existing databases adopt the baseline without change.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
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
        );
        CREATE TABLE IF NOT EXISTS rules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          is_active BOOLEAN DEFAULT 1,
          days TEXT NOT NULL DEFAULT 'mon,tue,wed,thu,fri,sat,sun',
          start_time TEXT NOT NULL DEFAULT '00:00',
          end_time TEXT NOT NULL DEFAULT '23:59',
          allowed_ratings TEXT DEFAULT '',
          blocked_ratings TEXT DEFAULT '',
          allowed_tv_ratings TEXT DEFAULT '',
          blocked_tv_ratings TEXT DEFAULT '',
          include_labels TEXT DEFAULT '',
          exclude_labels TEXT DEFAULT '',
          priority INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS user_rules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          rule_id INTEGER NOT NULL,
          assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (rule_id) REFERENCES rules(id) ON DELETE CASCADE,
          UNIQUE(user_id, rule_id)
        );
        CREATE TABLE IF NOT EXISTS activity_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          plex_username TEXT,
          rule_name TEXT,
          action TEXT NOT NULL,
          details TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS user_preferences (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER UNIQUE NOT NULL,
          accent_color TEXT DEFAULT '#f97316',
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS temporary_bypasses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          minutes INTEGER NOT NULL,
          expires_at DATETIME NOT NULL,
          created_by TEXT DEFAULT 'admin',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
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
        );
        CREATE TABLE IF NOT EXISTS enforcer_status (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          last_run DATETIME,
          last_success DATETIME,
          last_error TEXT,
          consecutive_failures INTEGER DEFAULT 0,
          token_valid INTEGER DEFAULT 1,
          last_backup_at DATETIME,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
      // Pre-migration databases may predate these columns.
      addColumnIfMissing(db, "users", "deactivated", "BOOLEAN DEFAULT 0");
      addColumnIfMissing(db, "rules", "priority", "INTEGER DEFAULT 0");
      addColumnIfMissing(db, "rules", "allowed_tv_ratings", "TEXT DEFAULT ''");
      addColumnIfMissing(db, "rules", "blocked_tv_ratings", "TEXT DEFAULT ''");
      try { db.prepare("INSERT INTO enforcer_status (id) VALUES (1)").run(); } catch (e) { /* exists */ }
    },
  },
  {
    version: 2,
    name: "applied_restrictions remembers the filters it wrote",
    // Lets the enforcer distinguish a rule edit from external drift (v1.1.14).
    up: (db) => {
      addColumnIfMissing(db, "applied_restrictions", "movie_filter", "TEXT");
      addColumnIfMissing(db, "applied_restrictions", "tv_filter", "TEXT");
    },
  },
  {
    version: 3,
    name: "activity_log index for retention pruning and paging",
    up: (db) => {
      db.exec("CREATE INDEX IF NOT EXISTS idx_activity_created_at ON activity_log(created_at)");
    },
  },
];

function addColumnIfMissing(db, table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function currentVersion(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      name TEXT,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const row = db.prepare("SELECT MAX(version) AS v FROM schema_version").get();
  return row && row.v ? row.v : 0;
}

/**
 * Apply every migration newer than the recorded version.
 * Safe to call concurrently from both processes: each migration runs in its own
 * transaction, and SQLite serializes writers.
 */
function migrate(db, log) {
  const say = log || (() => {});
  const from = currentVersion(db);
  const pending = MIGRATIONS.filter((m) => m.version > from);
  if (!pending.length) return { from, to: from, applied: [] };

  const applied = [];
  for (const m of pending) {
    const run = db.transaction(() => {
      m.up(db);
      db.prepare("INSERT OR REPLACE INTO schema_version (version, name) VALUES (?, ?)").run(m.version, m.name);
    });
    run();
    applied.push(m.version);
    say(`[MIGRATE] applied v${m.version}: ${m.name}`);
  }
  const to = currentVersion(db);
  return { from, to, applied };
}

module.exports = { migrate, currentVersion, MIGRATIONS, addColumnIfMissing };
