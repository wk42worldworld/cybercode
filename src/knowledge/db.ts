import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { Database } from 'bun:sqlite'
import { getKnowledgeDbPath } from './paths.js'

export function openKnowledgeDb(dbPath = getKnowledgeDbPath()): Database {
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  try {
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = NORMAL')
    db.exec('PRAGMA wal_autocheckpoint = 500')
  } catch {
    // Network filesystems may not support WAL; SQLite can still use its default journal.
  }
  ensureKnowledgeSchema(db)
  return db
}

export function ensureKnowledgeSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_sources (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('file', 'folder')),
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      document_count INTEGER NOT NULL DEFAULT 0,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      indexed_at TEXT
    );
  `)

  migrateDocumentIdentity(db)

  db.exec(`

    CREATE TABLE IF NOT EXISTS knowledge_documents (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      path TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      title TEXT NOT NULL,
      extension TEXT NOT NULL DEFAULT '',
      index_mode TEXT NOT NULL DEFAULT 'text' CHECK(index_mode IN ('text', 'metadata')),
      size_bytes INTEGER NOT NULL,
      mtime_ms REAL NOT NULL,
      content_hash TEXT NOT NULL DEFAULT '',
      indexed_at TEXT NOT NULL,
      error TEXT,
      FOREIGN KEY(source_id) REFERENCES knowledge_sources(id) ON DELETE CASCADE,
      UNIQUE(source_id, path)
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_documents_source_path
      ON knowledge_documents(source_id, relative_path);

    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      heading TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      FOREIGN KEY(source_id) REFERENCES knowledge_sources(id) ON DELETE CASCADE,
      FOREIGN KEY(document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_document
      ON knowledge_chunks(document_id, ordinal);

    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts
      USING fts5(
        chunk_id UNINDEXED,
        source_id UNINDEXED,
        document_id UNINDEXED,
        title,
        path,
        content
      );

    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts_trigram
      USING fts5(
        chunk_id UNINDEXED,
        source_id UNINDEXED,
        document_id UNINDEXED,
        title,
        path,
        content,
        tokenize='trigram'
      );
  `)
}

function migrateDocumentIdentity(db: Database): void {
  const row = db.query<{ sql: string | null }, []>(`
    SELECT sql FROM sqlite_master
    WHERE type = 'table' AND name = 'knowledge_documents'
  `).get()
  if (!row?.sql || /UNIQUE\s*\(\s*source_id\s*,\s*path\s*\)/i.test(row.sql)) return

  // Indexed content is derived data. Keep the user's source list and rebuild
  // documents when upgrading from the original globally-unique path schema.
  db.exec(`
    DROP TABLE IF EXISTS knowledge_fts;
    DROP TABLE IF EXISTS knowledge_fts_trigram;
    DROP TABLE IF EXISTS knowledge_chunks;
    DROP TABLE IF EXISTS knowledge_documents;
    UPDATE knowledge_sources
    SET status = 'pending', error = NULL, document_count = 0,
        chunk_count = 0, size_bytes = 0, indexed_at = NULL;
  `)
}
