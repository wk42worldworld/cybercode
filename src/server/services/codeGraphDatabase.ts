import { Database } from 'bun:sqlite'

export function openCodeGraphDatabaseForRead(dbPath: string) {
  let readonlyDatabase: Database | null = null
  try {
    readonlyDatabase = new Database(dbPath, { readonly: true })
    readonlyDatabase.query('PRAGMA schema_version').get()
    return readonlyDatabase
  } catch {
    try {
      readonlyDatabase?.close()
    } catch {
      // The failed WAL initialization may already have closed the handle.
    }
  }

  // WAL databases may need to create shared-memory bookkeeping before a read.
  // Bun's readonly mode rejects that when no -shm file exists, so reopen the
  // existing index read-write, then have SQLite reject every write statement.
  const walDatabase = new Database(dbPath, { readwrite: true, create: false })
  walDatabase.run('PRAGMA query_only = ON')
  return walDatabase
}
