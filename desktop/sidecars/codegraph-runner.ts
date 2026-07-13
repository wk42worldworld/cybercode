import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import {
  CodeGraph,
  setLogger,
  silentLogger,
} from './generated/codegraph-runtime'
import { compactCodeGraphWal } from './codegraphWal'

type CodeGraphInstance = {
  close(): void
  getStats(): Record<string, unknown>
  getLastIndexedAt(): number | null
  getIndexState(): string | null
  indexAll(options?: { onProgress?: (progress: IndexProgress) => void }): Promise<Record<string, unknown>>
  sync(options?: { onProgress?: (progress: IndexProgress) => void }): Promise<Record<string, unknown>>
  watch(options?: Record<string, unknown>): boolean
  searchNodes(query: string, options?: { limit?: number }): Array<{
    node: CodeGraphNode
    score: number
    highlights?: string[]
  }>
  buildContext(query: string, options?: Record<string, unknown>): Promise<unknown>
  getImpactRadius(nodeId: string, depth?: number): {
    nodes: CodeGraphNode[]
    edges: CodeGraphEdge[]
  }
  getCode(nodeId: string): Promise<string | null>
}

type CodeGraphNode = {
  id: string
  kind: string
  name: string
  qualifiedName: string
  filePath: string
  language: string
  startLine: number
  endLine: number
  signature?: string
}

type CodeGraphEdge = {
  source: string
  target: string
  kind: string
}

type IndexProgress = {
  phase: string
  current: number
  total: number
  currentFile?: string
}

type RuntimeClass = {
  isInitialized(projectPath: string): boolean
  init(projectPath: string): Promise<CodeGraphInstance>
  open(projectPath: string): Promise<CodeGraphInstance>
  recreate(projectPath: string): Promise<CodeGraphInstance>
}

const Runtime = CodeGraph as unknown as RuntimeClass

export async function runCodeGraphMode(rawArgs: string[]): Promise<void> {
  const { command, projectPath, rebuild } = parseArgs(rawArgs)
  process.env.CALLER_DIR = projectPath
  process.env.PWD = projectPath
  setLogger(silentLogger)

  switch (command) {
    case 'index':
      await runIndex(projectPath, rebuild)
      return
    case 'watch':
      await runWatcher(projectPath)
      return
    case 'mcp':
      await runMcpServer(projectPath)
      return
  }
}

async function runIndex(projectPath: string, rebuild: boolean) {
  let graph: CodeGraphInstance | null = null
  try {
    graph = rebuild && Runtime.isInitialized(projectPath)
      ? await Runtime.recreate(projectPath)
      : Runtime.isInitialized(projectPath)
        ? await Runtime.open(projectPath)
        : await Runtime.init(projectPath)

    const stats = graph.getStats()
    const hasExistingIndex = Number(stats.fileCount ?? 0) > 0
    const onProgress = (progress: IndexProgress) => emit({ type: 'progress', ...progress })
    const result = rebuild || !hasExistingIndex
      ? await graph.indexAll({ onProgress })
      : await graph.sync({ onProgress })

    const nextStats = graph.getStats()
    emit({
      type: 'complete',
      success: result.success !== false,
      result,
      stats: nextStats,
    })
    if (result.success === false) process.exitCode = 1
  } catch (error) {
    emit({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
    process.exitCode = 1
  } finally {
    graph?.close()
    compactWal(projectPath, true)
  }
}

async function runWatcher(projectPath: string) {
  if (!Runtime.isInitialized(projectPath)) {
    throw new Error(`CodeGraph index does not exist for ${projectPath}`)
  }
  const graph = await Runtime.open(projectPath)
  let lastSuccessfulSyncAt = Date.now()
  const watching = graph.watch({
    debounceMs: 1_200,
    onSyncComplete: (result: unknown) => {
      lastSuccessfulSyncAt = Date.now()
      emit({ type: 'sync', result })
      compactWal(projectPath, false)
    },
    onSyncError: (error: Error) => emit({ type: 'warning', message: error.message }),
    onDegraded: (reason: string) => emit({ type: 'warning', message: reason }),
  })
  if (!watching) {
    graph.close()
    throw new Error('CodeGraph file watcher could not be started')
  }
  emit({ type: 'watching' })

  // Close the gap between the initial index process exiting and this watcher
  // becoming active. This is especially important for empty projects, where
  // the first source file may be created immediately after the UI shows empty.
  try {
    const catchUpResult = await graph.sync()
    lastSuccessfulSyncAt = Date.now()
    emit({ type: 'sync', result: catchUpResult })
    compactWal(projectPath, false)
  } catch (error) {
    emit({
      type: 'warning',
      message: `Initial watcher sync failed: ${error instanceof Error ? error.message : String(error)}`,
    })
  }

  // Native filesystem notifications can be delayed or absent on external,
  // network, WSL, and some virtual volumes. Keep an adaptive polling fallback:
  // fast for empty/small projects, increasingly sparse for large repositories.
  let stopped = false
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null
  let fallbackSync: Promise<void> | null = null
  const scheduleFallbackSync = () => {
    if (stopped) return
    const fileCount = Number(graph.getStats().fileCount ?? 0)
    const delayMs = fileCount === 0
      ? 1_500
      : fileCount <= 100
        ? 5_000
        : fileCount <= 1_000
          ? 15_000
          : fileCount <= 5_000
            ? 30_000
            : 60_000
    fallbackTimer = setTimeout(() => {
      fallbackTimer = null
      if (stopped) return
      if (Date.now() - lastSuccessfulSyncAt < delayMs * 0.8) {
        scheduleFallbackSync()
        return
      }
      fallbackSync = (async () => {
        try {
          const result = await graph.sync()
          lastSuccessfulSyncAt = Date.now()
          emit({ type: 'sync', result })
          compactWal(projectPath, false)
        } catch (error) {
          emit({
            type: 'warning',
            message: `Fallback project sync failed: ${error instanceof Error ? error.message : String(error)}`,
          })
        }
      })().finally(() => {
        fallbackSync = null
        scheduleFallbackSync()
      })
    }, delayMs)
  }
  scheduleFallbackSync()

  await new Promise<void>((resolve) => {
    const finish = () => resolve()
    process.once('SIGINT', finish)
    process.once('SIGTERM', finish)
  })
  stopped = true
  if (fallbackTimer) clearTimeout(fallbackTimer)
  if (fallbackSync) await fallbackSync
  graph.close()
}

async function runMcpServer(projectPath: string) {
  let graph: CodeGraphInstance | null = null
  let graphPromise: Promise<CodeGraphInstance> | null = null
  let closed = false
  const getGraph = () => {
    if (closed) return Promise.reject(new Error('CodeGraph MCP server is closed'))
    if (graph) return Promise.resolve(graph)
    if (!graphPromise) {
      graphPromise = openGraphWhenReady(projectPath, () => closed).then((opened) => {
        if (closed) {
          opened.close()
          throw new Error('CodeGraph MCP server closed while waiting for the index')
        }
        graph = opened
        return opened
      })
    }
    return graphPromise
  }
  const server = new Server(
    { name: 'cybercode-codegraph', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'codegraph_search',
        description: 'Find exact code symbols and definitions without scanning files.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Symbol, file, or code concept to find.' },
            limit: { type: 'number', minimum: 1, maximum: 30, default: 12 },
          },
          required: ['query'],
        },
      },
      {
        name: 'codegraph_explore',
        description: 'Return compact, graph-ranked code context for an architecture or implementation question.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Question or task to explore in the codebase.' },
            maxNodes: { type: 'number', minimum: 5, maximum: 80, default: 30 },
          },
          required: ['query'],
        },
      },
      {
        name: 'codegraph_impact',
        description: 'Trace callers, dependents, and the likely blast radius of changing a symbol.',
        inputSchema: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Function, class, method, or qualified symbol name.' },
            depth: { type: 'number', minimum: 1, maximum: 5, default: 3 },
          },
          required: ['symbol'],
        },
      },
      {
        name: 'codegraph_status',
        description: 'Show local code graph coverage and freshness for the current project.',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments ?? {}
    switch (request.params.name) {
      case 'codegraph_search': {
        const graph = await getGraph()
        const query = requiredString(args.query, 'query')
        const limit = boundedNumber(args.limit, 12, 1, 30)
        const results = graph.searchNodes(query, { limit })
        const items = await Promise.all(results.map(async ({ node, score, highlights }) => ({
          ...compactNode(node),
          score,
          highlights,
          code: await graph.getCode(node.id),
        })))
        return textResult(JSON.stringify(items, null, 2))
      }
      case 'codegraph_explore': {
        const graph = await getGraph()
        const query = requiredString(args.query, 'query')
        const maxNodes = boundedNumber(args.maxNodes, 30, 5, 80)
        const result = await graph.buildContext(query, {
          maxNodes,
          maxCodeBlocks: 8,
          maxCodeBlockSize: 1_600,
          includeCode: true,
          format: 'markdown',
          traversalDepth: 2,
        })
        return textResult(typeof result === 'string' ? result : JSON.stringify(result, null, 2))
      }
      case 'codegraph_impact': {
        const graph = await getGraph()
        const symbol = requiredString(args.symbol, 'symbol')
        const depth = boundedNumber(args.depth, 3, 1, 5)
        const match = graph.searchNodes(symbol, { limit: 1 })[0]?.node
        if (!match) return textResult(`No indexed symbol matched: ${symbol}`, true)
        const impact = graph.getImpactRadius(match.id, depth)
        return textResult(JSON.stringify({
          focal: compactNode(match),
          nodes: impact.nodes.map(compactNode),
          edges: impact.edges,
        }, null, 2))
      }
      case 'codegraph_status': {
        if (!Runtime.isInitialized(projectPath)) {
          return textResult(JSON.stringify({
            projectPath,
            indexState: 'preparing',
            stats: null,
          }, null, 2))
        }
        const graph = await getGraph()
        return textResult(JSON.stringify({
          projectPath,
          indexState: graph.getIndexState(),
          lastIndexedAt: graph.getLastIndexedAt(),
          stats: graph.getStats(),
        }, null, 2))
      }
      default:
        return textResult(`Unknown CodeGraph tool: ${request.params.name}`, true)
    }
  })

  const transport = new StdioServerTransport()
  const closeGraph = () => {
    if (closed) return
    closed = true
    graph?.close()
    graph = null
  }
  const shutdown = () => {
    closeGraph()
    void server.close().finally(() => process.exit(0))
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  transport.onclose = closeGraph
  await server.connect(transport)
}

async function openGraphWhenReady(
  projectPath: string,
  isCancelled: () => boolean,
): Promise<CodeGraphInstance> {
  const deadline = Date.now() + 60_000
  while (!Runtime.isInitialized(projectPath)) {
    if (isCancelled()) throw new Error('CodeGraph MCP server closed before indexing started')
    if (Date.now() >= deadline) {
      throw new Error(`CodeGraph index was not initialized within 60 seconds: ${projectPath}`)
    }
    await Bun.sleep(200)
  }
  return Runtime.open(projectPath)
}

function compactWal(projectPath: string, force: boolean) {
  try {
    const result = compactCodeGraphWal(projectPath, force)
    if (result?.attempted && result.busy !== 0) {
      emit({
        type: 'warning',
        message: `CodeGraph WAL checkpoint is busy (${result.beforeBytes} bytes)`,
      })
    }
  } catch (error) {
    emit({
      type: 'warning',
      message: `CodeGraph WAL maintenance failed: ${error instanceof Error ? error.message : String(error)}`,
    })
  }
}

function compactNode(node: CodeGraphNode) {
  return {
    id: node.id,
    kind: node.kind,
    name: node.name,
    qualifiedName: node.qualifiedName,
    filePath: node.filePath,
    language: node.language,
    startLine: node.startLine,
    endLine: node.endLine,
    signature: node.signature,
  }
}

function textResult(text: string, isError = false) {
  return { content: [{ type: 'text' as const, text }], ...(isError ? { isError: true } : {}) }
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`)
  return value.trim()
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = typeof value === 'number' ? value : fallback
  return Math.max(min, Math.min(max, Math.round(number)))
}

function emit(payload: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function parseArgs(rawArgs: string[]) {
  const command = rawArgs[0]
  if (command !== 'index' && command !== 'watch' && command !== 'mcp') {
    throw new Error('codegraph mode requires index, watch, or mcp')
  }
  let projectPath = ''
  let rebuild = false
  for (let index = 1; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index]
    if (arg === '--project') {
      projectPath = rawArgs[index + 1] ?? ''
      index += 1
    } else if (arg === '--rebuild') {
      rebuild = true
    }
  }
  if (!projectPath) throw new Error('--project is required')
  return { command, projectPath, rebuild }
}
