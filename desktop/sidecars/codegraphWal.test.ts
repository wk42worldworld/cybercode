import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { compactCodeGraphWal } from './codegraphWal'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('CodeGraph WAL maintenance', () => {
  it('checkpoints and truncates a WAL while the writer connection remains open', () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cybercode-wal-test-'))
    temporaryDirectories.push(projectPath)
    const graphDir = path.join(projectPath, '.codegraph')
    const dbPath = path.join(graphDir, 'codegraph.db')
    fs.mkdirSync(graphDir, { recursive: true })

    const writer = new Database(dbPath, { create: true })
    writer.exec('PRAGMA journal_mode = WAL')
    writer.exec('PRAGMA wal_autocheckpoint = 0')
    writer.exec('CREATE TABLE payloads (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')
    const insert = writer.prepare('INSERT INTO payloads (value) VALUES (?)')
    for (let index = 0; index < 500; index += 1) insert.run('x'.repeat(2_048))

    const walPath = `${dbPath}-wal`
    const beforeBytes = fs.statSync(walPath).size
    const result = compactCodeGraphWal(projectPath, true)

    expect(beforeBytes).toBeGreaterThan(0)
    expect(result).toMatchObject({ attempted: true, busy: 0, afterBytes: 0 })
    expect(fs.statSync(walPath).size).toBe(0)
    writer.close()
  })
})
