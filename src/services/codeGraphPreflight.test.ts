import { Database } from 'bun:sqlite'
import { afterAll, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  buildCodeGraphPreflight,
  shouldRunCodeGraphPreflight,
} from './codeGraphPreflight.js'
import { estimateCodeGraphTokens } from './codeGraphTextBudget.js'

const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cybercode-preflight-test-'))
createPreflightFixture(projectDir)

afterAll(() => fs.rmSync(projectDir, { recursive: true, force: true }))

describe('Code Graph automatic preflight gate', () => {
  test('runs for structural questions in Chinese and English', () => {
    expect(shouldRunCodeGraphPreflight('这个登录模块的调用链和影响范围是什么？')).toBe(true)
    expect(shouldRunCodeGraphPreflight('Trace the dependency flow from createSession')).toBe(true)
  })

  test('runs for code-shaped symbols paired with an implementation action', () => {
    expect(shouldRunCodeGraphPreflight('帮我修改 CodeGraphService.getVisualization')).toBe(true)
    expect(shouldRunCodeGraphPreflight('Fix desktop/src/App.tsx')).toBe(true)
  })

  test('does not spend graph work on ordinary chat or bare slash commands', () => {
    expect(shouldRunCodeGraphPreflight('今天天气不错，我们聊聊天吧')).toBe(false)
    expect(shouldRunCodeGraphPreflight('/help')).toBe(false)
  })

  test('injects targeted source and relationships without launching another runtime', () => {
    const result = buildCodeGraphPreflight(
      projectDir,
      '修改 createSession 的调用链并分析影响',
      new AbortController().signal,
    )

    expect(result).toContain('<codegraph_context')
    expect(result).toContain('auth.createSession')
    expect(result).toContain('calls/extracted')
    expect(result).toContain('return token')
    expect(estimateCodeGraphTokens(result!)).toBeLessThanOrEqual(1_800)
  })

  test('returns a compact architecture report for a structural prompt without symbols', () => {
    const result = buildCodeGraphPreflight(
      projectDir,
      '分析这个项目的架构、入口和模块关系',
      new AbortController().signal,
    )

    expect(result).toContain('# Code Graph Architecture')
    expect(result).toContain('Relationship confidence')

    const english = buildCodeGraphPreflight(
      projectDir,
      'Please explain the project architecture and main modules',
      new AbortController().signal,
    )
    expect(english).toContain('# Code Graph Architecture')
  })
})

function createPreflightFixture(projectPath: string) {
  const graphDir = path.join(projectPath, '.codegraph')
  fs.mkdirSync(path.join(projectPath, 'src'), { recursive: true })
  fs.mkdirSync(graphDir, { recursive: true })
  fs.writeFileSync(
    path.join(projectPath, 'src', 'auth.ts'),
    [
      'export function login() {',
      '  return createSession()',
      '}',
      '',
      'export function createSession() {',
      "  const token = 'local'",
      '  return token',
      '}',
      '',
    ].join('\n'),
  )
  const db = new Database(path.join(graphDir, 'codegraph.db'), { create: true })
  db.run(`
    CREATE TABLE nodes (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      qualified_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      language TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      signature TEXT
    )
  `)
  db.run(`
    CREATE TABLE edges (
      id INTEGER PRIMARY KEY,
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      kind TEXT NOT NULL,
      line INTEGER,
      provenance TEXT
    )
  `)
  db.run(`
    INSERT INTO nodes VALUES
      ('login', 'function', 'login', 'auth.login', 'src/auth.ts', 'typescript', 1, 3, 'login()'),
      ('session', 'function', 'createSession', 'auth.createSession', 'src/auth.ts', 'typescript', 5, 8, 'createSession()')
  `)
  db.run(`
    INSERT INTO edges (id, source, target, kind, line, provenance)
    VALUES (1, 'login', 'session', 'calls', 2, 'tree-sitter')
  `)
  db.close()
}
