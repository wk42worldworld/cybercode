import { Database } from 'bun:sqlite'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { handleTokenOptimizationApi } from '../api/token-optimization.js'
import { CodeGraphService } from '../services/codeGraphService.js'

const originalConfigDir = process.env.CYBER_CONFIG_DIR
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cybercode-codegraph-test-'))
const configDir = path.join(testRoot, 'config')
const projectDir = path.join(testRoot, 'project')
const emptyProjectDir = path.join(testRoot, 'empty-project')
const inheritedProjectDir = path.join(testRoot, 'inherited-project')
const architectureProjectDir = path.join(testRoot, 'architecture-project')
fs.mkdirSync(projectDir, { recursive: true })
fs.mkdirSync(emptyProjectDir, { recursive: true })
fs.mkdirSync(inheritedProjectDir, { recursive: true })
fs.mkdirSync(architectureProjectDir, { recursive: true })
const canonicalProjectDir = fs.realpathSync.native(projectDir)
const canonicalEmptyProjectDir = fs.realpathSync.native(emptyProjectDir)

beforeAll(() => {
  process.env.CYBER_CONFIG_DIR = configDir
  createGraphDatabase(projectDir)
  createGraphDatabase(emptyProjectDir, false)
  createGraphDatabase(inheritedProjectDir)
  createArchitectureGraphDatabase(architectureProjectDir)
  const configPath = path.join(configDir, 'cybercode', 'codegraph.json')
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify({
    version: 1,
    projects: {
      [canonicalProjectDir]: { enabled: true, updatedAt: Date.now() },
      [canonicalEmptyProjectDir]: { enabled: true, updatedAt: Date.now() },
    },
  }))
})

afterAll(() => {
  if (originalConfigDir === undefined) delete process.env.CYBER_CONFIG_DIR
  else process.env.CYBER_CONFIG_DIR = originalConfigDir
  fs.rmSync(testRoot, { recursive: true, force: true })
})

describe('native Code Graph service', () => {
  test('migrates the old project switch into a global default for newly opened projects', () => {
    const service = new CodeGraphService()
    const status = service.getStatus(inheritedProjectDir)

    expect(status.enabled).toBe(true)
    expect(status.state).toBe('ready')
  })

  test('reads compact stats and visualization data from the local SQLite index', () => {
    const service = new CodeGraphService()
    const status = service.getStatus(projectDir)
    const graph = service.getVisualization(projectDir, 40)

    expect(status.state).toBe('ready')
    expect(status.stats).toMatchObject({
      fileCount: 1,
      nodeCount: 3,
      edgeCount: 2,
    })
    expect(graph.nodes).toHaveLength(3)
    expect(graph.edges).toHaveLength(2)
    expect(graph.nodes[0]).toMatchObject({
      communityId: expect.any(String),
      communityLabel: expect.any(String),
      role: expect.stringMatching(/^(hub|bridge|member)$/),
    })
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provenance: 'tree-sitter',
        confidence: 'extracted',
      }),
      expect.objectContaining({
        provenance: 'heuristic',
        confidence: 'inferred',
      }),
    ]))
    expect(graph.architecture).toMatchObject({
      analyzedNodeCount: 3,
      analyzedEdgeCount: 2,
      communities: expect.any(Array),
      confidence: { extracted: 1, inferred: 1, unknown: 0 },
    })
  })

  test('builds an embedded sidecar MCP config without npm, npx, or Python', () => {
    const service = new CodeGraphService()
    const config = service.getMcpConfig(projectDir)

    expect(config).not.toBeNull()
    const server = config!.mcpServers.cybercode_codegraph!
    expect(server.command).toBe(process.execPath)
    expect(server.args).toContain('codegraph')
    expect(server.args).toContain('mcp')
    expect([server.command, ...server.args].join(' ')).not.toMatch(/\b(npm|npx|python)\b/i)
    expect(server.env.CYBER_CODEGRAPH_ASSET_DIR).toContain('resources/codegraph')
    expect(server.env.CODEGRAPH_WAL_VALVE_MB).toBe('64')
  })

  test('detects stable architecture communities and cross-module bridges', () => {
    const service = new CodeGraphService()
    const first = service.getVisualization(architectureProjectDir, 80)
    const second = service.getVisualization(architectureProjectDir, 80)

    expect(first.architecture.communities.length).toBeGreaterThanOrEqual(2)
    expect(first.architecture.bridgeNodeIds.length).toBeGreaterThan(0)
    expect(first.nodes.some((node) => node.role === 'bridge')).toBe(true)
    expect(first.edges.some((edge) => edge.crossCommunity)).toBe(true)
    expect(
      second.architecture.communities.map((community) => community.id),
    ).toEqual(first.architecture.communities.map((community) => community.id))
  })

  test('reports an empty graph honestly and pre-mounts MCP for future source files', () => {
    const service = new CodeGraphService()
    const status = service.getStatus(emptyProjectDir)

    expect(status.state).toBe('empty')
    expect(status.stats).toMatchObject({
      fileCount: 0,
      nodeCount: 0,
      edgeCount: 0,
    })
    expect(service.getMcpConfig(emptyProjectDir)).not.toBeNull()
  })

  test('serves status and graph data through the token optimization API', async () => {
    const statusUrl = new URL(
      `http://localhost/api/token-optimization/codegraph?projectPath=${encodeURIComponent(projectDir)}`,
    )
    const statusResponse = await handleTokenOptimizationApi(
      new Request(statusUrl),
      statusUrl,
      ['api', 'token-optimization', 'codegraph'],
    )
    expect(statusResponse.status).toBe(200)
    expect((await statusResponse.json()).state).toBe('ready')

    const graphUrl = new URL(
      `http://localhost/api/token-optimization/codegraph/graph?projectPath=${encodeURIComponent(projectDir)}`,
    )
    const graphResponse = await handleTokenOptimizationApi(
      new Request(graphUrl),
      graphUrl,
      ['api', 'token-optimization', 'codegraph', 'graph'],
    )
    expect(graphResponse.status).toBe(200)
    expect((await graphResponse.json()).nodes).toHaveLength(3)
  })

  test('turns the global graph integration fully off and back on without a project path', async () => {
    const disableUrl = new URL('http://localhost/api/token-optimization/codegraph/global/disable')
    const disableResponse = await handleTokenOptimizationApi(
      new Request(disableUrl, { method: 'POST' }),
      disableUrl,
      ['api', 'token-optimization', 'codegraph', 'global', 'disable'],
    )
    expect(disableResponse.status).toBe(200)
    expect(await disableResponse.json()).toEqual({ enabled: false })

    const disabledService = new CodeGraphService()
    expect(disabledService.getStatus(inheritedProjectDir).enabled).toBe(false)
    expect(disabledService.getMcpConfig(inheritedProjectDir)).toBeNull()

    const enableUrl = new URL('http://localhost/api/token-optimization/codegraph/global/enable')
    const enableResponse = await handleTokenOptimizationApi(
      new Request(enableUrl, { method: 'POST' }),
      enableUrl,
      ['api', 'token-optimization', 'codegraph', 'global', 'enable'],
    )
    expect(enableResponse.status).toBe(200)
    expect(await enableResponse.json()).toEqual({ enabled: true })

    const enabledService = new CodeGraphService()
    expect(enabledService.getStatus(inheritedProjectDir).enabled).toBe(true)
    expect(enabledService.getMcpConfig(inheritedProjectDir)).not.toBeNull()
  })

  test('reports a filesystem root as unavailable for indexing', () => {
    const service = new CodeGraphService()
    expect(service.getStatus(path.parse(projectDir).root)).toMatchObject({
      indexable: false,
      state: 'disabled',
    })
  })

  test('refuses to index the entire user home directory', () => {
    const service = new CodeGraphService()
    expect(service.getStatus(os.homedir())).toMatchObject({
      projectPath: fs.realpathSync.native(os.homedir()),
      indexable: false,
      state: 'disabled',
    })
  })
})

function createGraphDatabase(projectPath: string, withContent = true) {
  const graphDir = path.join(projectPath, '.codegraph')
  fs.mkdirSync(graphDir, { recursive: true })
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
      end_line INTEGER NOT NULL
    )
  `)
  db.run(`
    CREATE TABLE edges (
      id INTEGER PRIMARY KEY,
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      kind TEXT NOT NULL,
      metadata TEXT,
      line INTEGER,
      col INTEGER,
      provenance TEXT
    )
  `)
  db.run(`
    CREATE TABLE files (
      path TEXT PRIMARY KEY,
      language TEXT NOT NULL,
      indexed_at INTEGER NOT NULL,
      errors TEXT
    )
  `)
  if (!withContent) {
    db.close()
    return
  }
  const insertNode = db.prepare(`
    INSERT INTO nodes (
      id, kind, name, qualified_name, file_path, language, start_line, end_line
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  insertNode.run('file:src/app.ts', 'file', 'app.ts', 'src/app.ts', 'src/app.ts', 'typescript', 1, 20)
  insertNode.run('function:run', 'function', 'run', 'run', 'src/app.ts', 'typescript', 3, 8)
  insertNode.run('class:Agent', 'class', 'Agent', 'Agent', 'src/app.ts', 'typescript', 10, 20)
  db.run("INSERT INTO edges (id, source, target, kind, line, provenance) VALUES (1, 'file:src/app.ts', 'function:run', 'contains', 3, 'tree-sitter')")
  db.run("INSERT INTO edges (id, source, target, kind, line, provenance) VALUES (2, 'function:run', 'class:Agent', 'references', 5, 'heuristic')")
  db.run("INSERT INTO files (path, language, indexed_at, errors) VALUES ('src/app.ts', 'typescript', ?, '[]')", [Date.now()])
  db.close()
}

function createArchitectureGraphDatabase(projectPath: string) {
  const graphDir = path.join(projectPath, '.codegraph')
  fs.mkdirSync(graphDir, { recursive: true })
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
      end_line INTEGER NOT NULL
    )
  `)
  db.run(`
    CREATE TABLE edges (
      id INTEGER PRIMARY KEY,
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      kind TEXT NOT NULL,
      metadata TEXT,
      line INTEGER,
      col INTEGER,
      provenance TEXT
    )
  `)
  db.run(`
    CREATE TABLE files (
      path TEXT PRIMARY KEY,
      language TEXT NOT NULL,
      indexed_at INTEGER NOT NULL,
      errors TEXT
    )
  `)
  const insertNode = db.prepare(`
    INSERT INTO nodes (
      id, kind, name, qualified_name, file_path, language, start_line, end_line
    ) VALUES (?, ?, ?, ?, ?, 'typescript', ?, ?)
  `)
  insertNode.run('auth:file', 'file', 'auth.ts', 'src/auth/auth.ts', 'src/auth/auth.ts', 1, 80)
  insertNode.run('auth:login', 'function', 'login', 'auth.login', 'src/auth/auth.ts', 5, 20)
  insertNode.run('auth:session', 'function', 'createSession', 'auth.createSession', 'src/auth/session.ts', 1, 30)
  insertNode.run('billing:file', 'file', 'billing.ts', 'src/billing/billing.ts', 'src/billing/billing.ts', 1, 90)
  insertNode.run('billing:invoice', 'function', 'createInvoice', 'billing.createInvoice', 'src/billing/invoice.ts', 4, 24)
  insertNode.run('billing:payment', 'function', 'capturePayment', 'billing.capturePayment', 'src/billing/payment.ts', 3, 28)
  const insertEdge = db.prepare(`
    INSERT INTO edges (id, source, target, kind, line, provenance)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  insertEdge.run(1, 'auth:file', 'auth:login', 'contains', 5, 'tree-sitter')
  insertEdge.run(2, 'auth:login', 'auth:session', 'calls', 12, 'tree-sitter')
  insertEdge.run(3, 'auth:session', 'auth:login', 'references', 18, 'tree-sitter')
  insertEdge.run(4, 'billing:file', 'billing:invoice', 'contains', 4, 'tree-sitter')
  insertEdge.run(5, 'billing:invoice', 'billing:payment', 'calls', 14, 'tree-sitter')
  insertEdge.run(6, 'billing:payment', 'billing:invoice', 'references', 20, 'tree-sitter')
  insertEdge.run(7, 'auth:session', 'billing:payment', 'references', 22, 'heuristic')
  db.run("INSERT INTO files (path, language, indexed_at, errors) VALUES ('src/auth/auth.ts', 'typescript', ?, '[]')", [Date.now()])
  db.run("INSERT INTO files (path, language, indexed_at, errors) VALUES ('src/billing/billing.ts', 'typescript', ?, '[]')", [Date.now()])
  db.close()
}
