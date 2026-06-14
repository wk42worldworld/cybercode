import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { Database } from 'bun:sqlite'
import { getSessionSearchDbPath } from './paths.js'

export type SessionSearchDatabase = Database

export function openSessionSearchDb(dbPath = getSessionSearchDbPath()): Database {
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  try {
    db.exec('PRAGMA journal_mode = WAL')
  } catch {
    // Some filesystems do not support WAL. SQLite still works in default mode.
  }
  db.exec('PRAGMA busy_timeout = 5000')
  ensureSessionSearchSchema(db)
  return db
}

export function ensureSessionSearchSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_key TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      project_path TEXT NOT NULL,
      work_dir TEXT,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      modified_at TEXT NOT NULL,
      file_path TEXT NOT NULL UNIQUE,
      file_mtime_ms REAL NOT NULL,
      file_size INTEGER NOT NULL,
      message_count INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS indexed_files (
      file_path TEXT PRIMARY KEY,
      session_key TEXT NOT NULL,
      session_id TEXT NOT NULL,
      project_path TEXT NOT NULL,
      file_mtime_ms REAL NOT NULL,
      file_size INTEGER NOT NULL,
      indexed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_key TEXT NOT NULL,
      session_id TEXT NOT NULL,
      project_path TEXT NOT NULL,
      message_uuid TEXT NOT NULL,
      role TEXT NOT NULL,
      type TEXT NOT NULL,
      content_text TEXT NOT NULL,
      timestamp TEXT,
      model TEXT,
      line_no INTEGER NOT NULL,
      is_sidechain INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session_order
      ON messages(session_key, line_no, id);
    CREATE INDEX IF NOT EXISTS idx_messages_session_id
      ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_project_modified
      ON sessions(project_path, modified_at DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts
      USING fts5(content_text);
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts_trigram
      USING fts5(content_text, tokenize='trigram');
  `)
}

export function sessionKey(projectPath: string, sessionId: string): string {
  return `${projectPath}:${sessionId}`
}
