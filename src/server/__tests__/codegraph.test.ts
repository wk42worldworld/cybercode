import { Database } from 'bun:sqlite'
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { handleTokenOptimizationApi } from '../api/token-optimization.js'
import { getCodeGraphVisualization } from '../services/codeGraphAnalysis.js'
import { openCodeGraphDatabaseForRead } from '../services/codeGraphDatabase.js'
import { CodeGraphService, codeGraphService } from '../services/codeGraphService.js'

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

afterAll(async () => {
  await codeGraphService.disableGlobal()
  if (originalConfigDir === undefined) delete process.env.CYBER_CONFIG_DIR
  else process.env.CYBER_CONFIG_DIR = originalConfigDir
  fs.rmSync(testRoot, { recursive: true, force: true })
})

describe('native Code Graph service', () => {
  test('defaults the global graph on and preserves an explicit opt-out', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cybercode-codegraph-default-'))
    const configPath = path.join(root, 'codegraph.json')
    const bindConfigPath = (service: CodeGraphService) => {
      ;(service as unknown as { getConfigPath: () => string }).getConfigPath = () => configPath
    }
    const service = new CodeGraphService()
    const reader = new CodeGraphService()
    bindConfigPath(service)
    bindConfigPath(reader)

    try {
      expect(service.getGlobalStatus()).toEqual({ enabled: true })
      expect(await service.disableGlobal()).toEqual({ enabled: false })
      expect(reader.getGlobalStatus()).toEqual({ enabled: false })
    } finally {
      service.shutdown()
      reader.shutdown()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test('reads a WAL index after its shared-memory file has been cleaned up', () => {
    const dbPath = path.join(testRoot, 'wal-without-shm.db')
    const writer = new Database(dbPath, { create: true })
    writer.run('PRAGMA journal_mode = WAL')
    writer.run('CREATE TABLE sample (value TEXT NOT NULL)')
    writer.run("INSERT INTO sample VALUES ('ready')")
    writer.run('PRAGMA wal_checkpoint(TRUNCATE)')
    writer.close()
    fs.rmSync(`${dbPath}-wal`, { force: true })
    fs.rmSync(`${dbPath}-shm`, { force: true })

    const reader = openCodeGraphDatabaseForRead(dbPath)
    try {
      expect(reader.query<{ value: string }, []>('SELECT value FROM sample').get()?.value).toBe('ready')
      expect(() => reader.run("INSERT INTO sample VALUES ('blocked')")).toThrow()
    } finally {
      reader.close()
    }
  })

  test('keeps the visualization within its hard limit when every node is a separate community', () => {
    const dbPath = path.join(testRoot, 'many-communities.db')
    const db = new Database(dbPath, { create: true })
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
        kind TEXT NOT NULL
      )
    `)
    const insertNode = db.prepare(`
      INSERT INTO nodes VALUES (?, 'function', ?, ?, ?, 'typescript', 1, 2)
    `)
    for (let index = 0; index < 36; index += 1) {
      const name = `isolated${index}`
      insertNode.run(name, name, name, `src/module-${index}/${name}.ts`)
    }
    db.close()

    const graph = getCodeGraphVisualization(dbPath, 20)
    expect(graph.nodes).toHaveLength(20)
    expect(new Set(graph.nodes.map((node) => node.id)).size).toBe(20)
  })

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

  test('keeps reporting preparation while a rebuild is waiting to start', async () => {
    const service = new CodeGraphService()
    const preparation = Promise.withResolvers<void>()
    const spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() =>
      createFakeWatchProcess(Promise.resolve(0)),
    )
    let pendingRun: Promise<void> | null = null
    const internals = service as unknown as {
      patchRunningSessions: () => Promise<void>
      runIndex: (projectPath: string, rebuild: boolean) => Promise<void>
    }
    internals.patchRunningSessions = () => preparation.promise
    const originalRunIndex = internals.runIndex.bind(service)
    internals.runIndex = (projectPath, rebuild) => {
      pendingRun = originalRunIndex(projectPath, rebuild)
      return pendingRun
    }

    try {
      service.enableGlobal()
      const rebuildStatus = await service.rebuild(projectDir)

      expect(rebuildStatus.state).toBe('preparing')
      expect(service.getStatus(projectDir).state).toBe('preparing')

      service.shutdown()
      preparation.resolve()
      await pendingRun

      expect(spawnSpy).not.toHaveBeenCalled()
    } finally {
      service.shutdown()
      preparation.resolve()
      spawnSpy.mockRestore()
    }
  })

  test('does not revive a pending index after Code Graph is disabled', async () => {
    const service = new CodeGraphService()
    const preparation = Promise.withResolvers<void>()
    const spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() =>
      createFakeWatchProcess(Promise.resolve(0)),
    )
    let patchCallCount = 0
    let pendingRun: Promise<void> | null = null
    const internals = service as unknown as {
      patchRunningSessions: () => Promise<void>
      runIndex: (projectPath: string, rebuild: boolean) => Promise<void>
      setGlobalEnabled: (enabled: boolean) => void
    }
    internals.patchRunningSessions = () => {
      patchCallCount += 1
      return patchCallCount === 1 ? preparation.promise : Promise.resolve()
    }
    const originalRunIndex = internals.runIndex.bind(service)
    internals.runIndex = (projectPath, rebuild) => {
      pendingRun = originalRunIndex(projectPath, rebuild)
      return pendingRun
    }

    try {
      service.enableGlobal()
      await service.rebuild(projectDir)

      expect(service.getStatus(projectDir).state).toBe('preparing')
      expect(await service.disableGlobal()).toEqual({ enabled: false })

      preparation.resolve()
      await pendingRun

      expect(spawnSpy).not.toHaveBeenCalled()
      expect(service.getStatus(projectDir)).toMatchObject({
        enabled: false,
        state: 'disabled',
      })
    } finally {
      service.shutdown()
      preparation.resolve()
      internals.setGlobalEnabled(true)
      spawnSpy.mockRestore()
    }
  })

  test('keeps a newly enabled index owned when an old preparation finishes late', async () => {
    const service = new CodeGraphService()
    const oldPreparation = Promise.withResolvers<void>()
    const newPreparation = Promise.withResolvers<void>()
    const spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() =>
      createFakeWatchProcess(Promise.resolve(0)),
    )
    const runs: Promise<void>[] = []
    let patchCallCount = 0
    const internals = service as unknown as {
      patchRunningSessions: () => Promise<void>
      runIndex: (projectPath: string, rebuild: boolean) => Promise<void>
    }
    internals.patchRunningSessions = () => {
      patchCallCount += 1
      if (patchCallCount === 1) return oldPreparation.promise
      if (patchCallCount === 3) return newPreparation.promise
      return Promise.resolve()
    }
    const originalRunIndex = internals.runIndex.bind(service)
    internals.runIndex = (projectPath, rebuild) => {
      const run = originalRunIndex(projectPath, rebuild)
      runs.push(run)
      return run
    }

    try {
      service.enableGlobal()
      await service.rebuild(projectDir)
      expect(runs).toHaveLength(1)

      await service.disableGlobal()
      service.enableGlobal()
      expect(runs).toHaveLength(2)

      oldPreparation.resolve()
      await runs[0]
      service.ensureProject(projectDir)

      expect(runs).toHaveLength(2)
      expect(service.getStatus(projectDir).state).toBe('preparing')
      expect(spawnSpy).not.toHaveBeenCalled()
    } finally {
      service.shutdown()
      oldPreparation.resolve()
      newPreparation.resolve()
      await Promise.all(runs)
      spawnSpy.mockRestore()
    }
  })

  test('restarts an unexpectedly exited file watcher', async () => {
    const service = new CodeGraphService({ watcherRestartBaseDelayMs: 1 })
    const secondExit = Promise.withResolvers<number>()
    let spawnCount = 0
    const spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
      spawnCount += 1
      return createFakeWatchProcess(
        spawnCount === 1 ? Promise.resolve(1) : secondExit.promise,
      )
    })
    const internals = service as unknown as {
      startWatcher: (projectPath: string) => void
    }

    try {
      service.enableGlobal()
      internals.startWatcher(projectDir)
      for (let attempt = 0; attempt < 20 && spawnCount < 2; attempt += 1) {
        await Bun.sleep(2)
      }

      expect(spawnCount).toBe(2)
      service.shutdown()
      secondExit.resolve(0)
      await Bun.sleep(5)
      expect(spawnCount).toBe(2)
    } finally {
      service.shutdown()
      secondExit.resolve(0)
      spawnSpy.mockRestore()
    }
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

function createFakeWatchProcess(exited: Promise<number>) {
  const emptyStream = () => new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close()
    },
  })
  return {
    stdout: emptyStream(),
    stderr: emptyStream(),
    exited,
    kill() {},
  } as unknown as ReturnType<typeof Bun.spawn>
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
