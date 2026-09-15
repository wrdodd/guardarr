import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { mkdirSync } from 'fs';

// Avoid database operations during build time
const isBuild = process.env.NODE_ENV === 'production' && typeof window === 'undefined' && process.env.NEXT_PHASE === 'phase-production-build';

let dbInstance: Database.Database | null = null;

function getDbPath(): string {
  return process.env.DATABASE_URL || join(process.cwd(), 'data', 'guardarr.db');
}

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;

  const dbPath = getDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });
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

// Initialize schema.
//
// Schema definition lives in lib/migrations.js as an ordered, versioned list shared
// with the standalone enforcer. Previously both processes raced to CREATE TABLE at
// startup and columns were added via scattered `try { ALTER TABLE } catch {}` blocks
// with no record of what had been applied.
export function initDatabase() {
  if (isBuild) return; // Skip during build

  const db = getDb();
  const { migrate } = require('./migrations.js');
  const result = migrate(db, (m: string) => console.log(m));
  if (result.applied.length) {
    console.log(`[DB] schema migrated ${result.from} -> ${result.to}`);
  }
}

// Initialize on module load (but not during build)
if (!isBuild) {
  initDatabase();
}
