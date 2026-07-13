import { Database } from 'bun:sqlite'
import * as fs from 'node:fs'
import * as path from 'node:path'

export const CODEGRAPH_WAL_COMPACT_THRESHOLD_BYTES = 64 * 1024 * 1024

export type WalCompactResult = {
  attempted: boolean
  beforeBytes: number
  afterBytes: number
  busy: number
  log: number
  checkpointed: number
}

export function compactCodeGraphWal(
  projectPath: string,
  force = false,
): WalCompactResult | null {
  const dbPath = path.join(projectPath, '.codegraph', 'codegraph.db')
  const walPath = `${dbPath}-wal`
  if (!fs.existsSync(dbPath)) return null

  const beforeBytes = fileSize(walPath)
  if (!force && beforeBytes < CODEGRAPH_WAL_COMPACT_THRESHOLD_BYTES) {
    return {
      attempted: false,
      beforeBytes,
      afterBytes: beforeBytes,
      busy: 0,
      log: 0,
      checkpointed: 0,
    }
  }

  const db = new Database(dbPath)
  try {
    db.exec('PRAGMA busy_timeout = 1500')
    const row = db.query<{
      busy: number
      log: number
      checkpointed: number
    }, []>('PRAGMA wal_checkpoint(TRUNCATE)').get()
    return {
      attempted: true,
      beforeBytes,
      afterBytes: fileSize(walPath),
      busy: Number(row?.busy || 0),
      log: Number(row?.log || 0),
      checkpointed: Number(row?.checkpointed || 0),
    }
  } finally {
    db.close()
  }
}

function fileSize(filePath: string) {
  try {
    return fs.statSync(filePath).size
  } catch {
    return 0
  }
}
