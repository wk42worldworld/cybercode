import { Database } from 'bun:sqlite'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { assembleToolPool } from '../../tools.js'
import { runWithCwdOverride } from '../../utils/cwd.js'
import { CodeGraphTool } from './CodeGraphTool.js'
import { CODEGRAPH_MCP_SERVER_NAME } from './constants.js'

const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cybercode-native-graph-'))
const configDir = path.join(projectDir, 'config')
const originalConfigDir = process.env.CYBER_CONFIG_DIR

beforeAll(() => {
  process.env.CYBER_CONFIG_DIR = configDir
  fs.mkdirSync(path.join(configDir, 'cybercode'), { recursive: true })
  fs.writeFileSync(
    path.join(configDir, 'cybercode', 'codegraph.json'),
    JSON.stringify({ enabled: true, projects: {} }),
  )
  createFixture(projectDir)
})

afterAll(() => {
  if (originalConfigDir === undefined) delete process.env.CYBER_CONFIG_DIR
  else process.env.CYBER_CONFIG_DIR = originalConfigDir
  fs.rmSync(projectDir, { recursive: true, force: true })
})

describe('native CodeGraph tool', () => {
  test('queries the local graph when the desktop MCP runtime is unavailable', async () => {
    const result = await runWithCwdOverride(projectDir, () => CodeGraphTool.call(
      { action: 'search', query: 'createSession' },
      contextWithTools([]),
      (() => Promise.resolve({ behavior: 'allow' })) as never,
      {} as never,
      undefined,
    ))

    expect(result.data.success).toBe(true)
    expect(result.data.source).toBe('local')
    expect(result.data.content).toContain('auth.createSession')
  })

  test('uses the attached runtime while keeping the MCP implementation internal', async () => {
    const runtimeTool = {
      mcpInfo: {
        serverName: CODEGRAPH_MCP_SERVER_NAME,
        toolName: 'codegraph_impact',
      },
      call: async () => ({
        data: [{ type: 'text', text: 'runtime impact result' }],
      }),
    }
    const result = await runWithCwdOverride(projectDir, () => CodeGraphTool.call(
      { action: 'impact', query: 'createSession', depth: 2 },
      contextWithTools([runtimeTool]),
      (() => Promise.resolve({ behavior: 'allow' })) as never,
      {} as never,
      undefined,
    ))

    expect(result.data).toEqual({
      success: true,
      source: 'runtime',
      content: 'runtime impact result',
    })
  })

  test('falls back to the local index when the attached runtime disconnects', async () => {
    const runtimeTool = {
      mcpInfo: {
        serverName: CODEGRAPH_MCP_SERVER_NAME,
        toolName: 'codegraph_search',
      },
      call: async () => {
        throw new Error('MCP connection closed')
      },
    }
    const result = await runWithCwdOverride(projectDir, () => CodeGraphTool.call(
      { action: 'search', query: 'createSession' },
      contextWithTools([runtimeTool]),
      (() => Promise.resolve({ behavior: 'allow' })) as never,
      {} as never,
      undefined,
    ))

    expect(result.data.success).toBe(true)
    expect(result.data.source).toBe('local')
    expect(result.data.content).toContain('auth.createSession')
  })

  test('rejects graph actions that need a query before execution', async () => {
    expect(await CodeGraphTool.validateInput?.({ action: 'impact' } as never)).toEqual({
      result: false,
      message: 'CodeGraph impact requires a query.',
      errorCode: 1,
    })
  })

  test('removes internal CodeGraph MCP tools from the model-facing pool', () => {
    const internalTool = {
      ...CodeGraphTool,
      name: 'mcp__cybercode_codegraph__codegraph_search',
      mcpInfo: {
        serverName: CODEGRAPH_MCP_SERVER_NAME,
        toolName: 'codegraph_search',
      },
    }
    const tools = assembleToolPool(
      getEmptyToolPermissionContext(),
      [internalTool],
    )

    expect(tools.some((tool) => tool.name === 'CodeGraph')).toBe(true)
    expect(tools.some((tool) => tool.mcpInfo?.serverName === CODEGRAPH_MCP_SERVER_NAME)).toBe(false)
  })

  test('the global switch removes and restores the native tool', async () => {
    const configPath = path.join(configDir, 'cybercode', 'codegraph.json')
    fs.writeFileSync(configPath, JSON.stringify({ enabled: false, projects: {} }))
    expect(CodeGraphTool.isEnabled()).toBe(false)
    expect(assembleToolPool(
      getEmptyToolPermissionContext(),
      [],
    ).some((tool) => tool.name === 'CodeGraph')).toBe(false)
    const disabled = await runWithCwdOverride(projectDir, () => CodeGraphTool.call(
      { action: 'status' },
      contextWithTools([]),
      (() => Promise.resolve({ behavior: 'allow' })) as never,
      {} as never,
      undefined,
    ))
    expect(disabled.data.success).toBe(false)
    expect(disabled.data.content).toContain('disabled globally')

    fs.writeFileSync(configPath, JSON.stringify({ enabled: true, projects: {} }))
    expect(CodeGraphTool.isEnabled()).toBe(true)
    expect(assembleToolPool(
      getEmptyToolPermissionContext(),
      [],
    ).some((tool) => tool.name === 'CodeGraph')).toBe(true)
  })
})

function contextWithTools(tools: unknown[]) {
  return {
    abortController: new AbortController(),
    getAppState: () => ({ mcp: { tools } }),
  } as never
}

function createFixture(projectPath: string) {
  const graphDir = path.join(projectPath, '.codegraph')
  fs.mkdirSync(path.join(projectPath, 'src'), { recursive: true })
  fs.mkdirSync(graphDir, { recursive: true })
  fs.writeFileSync(path.join(projectPath, 'src', 'auth.ts'), [
    'export function createSession() {',
    "  return 'token'",
    '}',
  ].join('\n'))
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
      ('session', 'function', 'createSession', 'auth.createSession', 'src/auth.ts', 'typescript', 1, 3, 'createSession()')
  `)
  db.close()
}
