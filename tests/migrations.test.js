const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { migrate, currentVersion, MIGRATIONS } = require("../lib/migrations.js");

const fresh = () => new Database(":memory:");
const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);

test("a fresh database migrates to the latest version", () => {
  const db = fresh();
  const result = migrate(db);
  assert.equal(result.from, 0);
  assert.equal(result.to, MIGRATIONS[MIGRATIONS.length - 1].version);
  assert.ok(result.applied.length > 0);
  // core tables exist
  for (const t of ["settings", "users", "rules", "user_rules", "activity_log",
                   "temporary_bypasses", "applied_restrictions", "enforcer_status"]) {
    assert.ok(cols(db, t).length > 0, `missing table ${t}`);
  }
});

test("migrating twice is a no-op", () => {
  const db = fresh();
  migrate(db);
  const second = migrate(db);
  assert.deepEqual(second.applied, []);
  assert.equal(second.from, second.to);
});

test("v2 adds the durable filter columns the enforcer relies on", () => {
  const db = fresh();
  migrate(db);
  const c = cols(db, "applied_restrictions");
  assert.ok(c.includes("movie_filter"));
  assert.ok(c.includes("tv_filter"));
});

test("an existing pre-migration database is upgraded without data loss", () => {
  // Simulate a v1.1.13 database: tables exist, schema_version does not, and
  // applied_restrictions predates the filter columns.
  const db = fresh();
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at DATETIME);
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, plex_id TEXT UNIQUE NOT NULL, plex_username TEXT NOT NULL);
    CREATE TABLE rules (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, is_active BOOLEAN DEFAULT 1,
      days TEXT NOT NULL DEFAULT 'all', start_time TEXT NOT NULL DEFAULT '00:00', end_time TEXT NOT NULL DEFAULT '23:59');
    CREATE TABLE activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, created_at DATETIME);
    CREATE TABLE applied_restrictions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      rule_id INTEGER NOT NULL, plex_tv_id TEXT NOT NULL, username TEXT NOT NULL, rule_name TEXT NOT NULL,
      applied_at DATETIME, UNIQUE(user_id, rule_id));
  `);
  db.prepare("INSERT INTO users (plex_id, plex_username) VALUES ('42','kid')").run();
  db.prepare("INSERT INTO settings (key,value) VALUES ('timezone','America/Los_Angeles')").run();

  assert.equal(currentVersion(db), 0);
  migrate(db);

  // data survived
  assert.equal(db.prepare("SELECT plex_username FROM users WHERE plex_id='42'").get().plex_username, "kid");
  assert.equal(db.prepare("SELECT value FROM settings WHERE key='timezone'").get().value, "America/Los_Angeles");
  // and the new columns were added to the pre-existing table
  const c = cols(db, "applied_restrictions");
  assert.ok(c.includes("movie_filter") && c.includes("tv_filter"));
  // legacy rules table gained the columns the app expects
  const rc = cols(db, "rules");
  assert.ok(rc.includes("priority") && rc.includes("allowed_tv_ratings") && rc.includes("blocked_tv_ratings"));
});

test("version numbers are unique and ordered", () => {
  const versions = MIGRATIONS.map((m) => m.version);
  assert.deepEqual(versions, [...versions].sort((a, b) => a - b));
  assert.equal(new Set(versions).size, versions.length);
});

test("the applied version is recorded", () => {
  const db = fresh();
  migrate(db);
  const rows = db.prepare("SELECT version, name FROM schema_version ORDER BY version").all();
  assert.equal(rows.length, MIGRATIONS.length);
  assert.equal(rows[0].version, 1);
});
