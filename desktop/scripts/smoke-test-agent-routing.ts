import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { detectHostTriple } from './sidecarTarget'

const desktopRoot = path.resolve(import.meta.dir, '..')
const repoRoot = path.resolve(desktopRoot, '..')
const targetTriple = process.env.TAURI_ENV_TARGET_TRIPLE
  || process.env.CARGO_BUILD_TARGET
  || await detectHostTriple(repoRoot)
const executableBase = path.join(
  desktopRoot,
  'src-tauri',
  'binaries',
  `cybercode-sidecar-${targetTriple}`,
)
const executable = [executableBase, `${executableBase}.exe`].find(existsSync)

if (!executable) {
  throw new Error(`[agent-routing-smoke] Missing sidecar executable: ${executableBase}`)
}

const temporaryHome = await mkdtemp(path.join(tmpdir(), 'cybercode-agent-routing-smoke-'))
const authToken = 'cybercode-agent-routing-smoke'
const marker = 'USER_JOURNEY_MARKER_KEEP_ORIGINAL_TASK'
let routerCalls = 0
let fastCalls = 0
let qualityCalls = 0
const generationBodies: string[] = []

const upstream = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    if (request.method === 'GET' && new URL(request.url).pathname.endsWith('/models')) {
      return Response.json({
        object: 'list',
        data: [
          { id: 'router-model', object: 'model' },
          { id: 'fast-model', object: 'model' },
          { id: 'quality-model', object: 'model' },
        ],
      })
    }
    const key = request.headers.get('authorization')?.replace('Bearer ', '') ?? ''
    const body = await request.json() as Record<string, unknown>
    const serialized = JSON.stringify(body)
    const model = typeof body.model === 'string' ? body.model : 'unknown-model'

    if (key === 'router-key') {
      routerCalls += 1
      const outputPortId = serialized.includes('PLANNER_AGENT')
        ? 'delegate'
        : serialized.includes('ARCHITECT_AGENT') || serialized.includes('REVIEWER_AGENT')
          ? 'continue'
          : 'quality'
      return openAIResponse(model, JSON.stringify({ outputPortId, confidence: 1 }))
    }

    generationBodies.push(serialized)
    if (key === 'fast-key') fastCalls += 1
    if (key === 'quality-key') qualityCalls += 1
    return openAIResponse(model, key === 'quality-key' ? 'journey-ok' : 'unexpected-model')
  },
})

let sidecar: Awaited<ReturnType<typeof startSidecar>> | undefined

try {
  sidecar = await startSidecar()
  const routerId = await addProvider(sidecar.port, 'Router', 'router-key', 'router-model')
  const fastId = await addProvider(sidecar.port, 'Fast', 'fast-key', 'fast-model')
  const qualityId = await addProvider(sidecar.port, 'Quality', 'quality-key', 'quality-model')

  const completeGraph = buildGraph(routerId, fastId, qualityId)
  const incompleteGraph = structuredClone(completeGraph)
  const planner = incompleteGraph.nodes.find((node) => node.id === 'planner')
  if (!planner || planner.type !== 'agent') throw new Error('Planner node is missing')
  planner.config.instructions = ''
  incompleteGraph.edges = incompleteGraph.edges.filter((edge) => edge.id !== 'planner-direct')

  await putRoutingConfig(sidecar.port, incompleteGraph)
  const savedDraft = await apiJson<{
    config: { profiles: Array<{ draftGraph?: { version?: number } }> }
  }>(sidecar.port, '/api/routing/config')
  assert(savedDraft.config.profiles[0]?.draftGraph?.version === 3, 'V3 draft was not persisted')

  const rejectedPublish = await apiFetch(sidecar.port, '/api/routing/publish', {
    method: 'POST',
    body: JSON.stringify({ profileId: 'user-journey' }),
  })
  assert(rejectedPublish.status === 400, `Incomplete draft published with HTTP ${rejectedPublish.status}`)

  await putRoutingConfig(sidecar.port, completeGraph)
  const published = await apiFetch(sidecar.port, '/api/routing/publish', {
    method: 'POST',
    body: JSON.stringify({ profileId: 'user-journey', name: 'User journey route' }),
  })
  assert(published.ok, `Complete route failed to publish: HTTP ${published.status} ${await published.text()}`)

  await sidecar.stop()
  sidecar = await startSidecar()

  const reloaded = await apiJson<{
    config: { profiles: Array<{ graph?: { version?: number }; name?: string }> }
  }>(sidecar.port, '/api/routing/config')
  assert(reloaded.config.profiles[0]?.graph?.version === 3, 'Published V3 graph did not survive restart')
  assert(reloaded.config.profiles[0]?.name === 'User journey route', 'Published route name did not survive restart')

  const response = await apiFetch(
    sidecar.port,
    '/proxy/routes/user-journey/sessions/smoke-session/v1/messages',
    {
      method: 'POST',
      body: JSON.stringify({
        model: 'cybercode-route-user-journey',
        max_tokens: 64,
        stream: false,
        messages: [{ role: 'user', content: marker }],
      }),
      signal: AbortSignal.timeout(20_000),
    },
  )
  const responseText = await response.text()
  assert(response.ok, `Published route execution failed: HTTP ${response.status} ${responseText}`)
  assert(responseText.includes('journey-ok'), 'The expected quality model response was not returned')
  assert(routerCalls === 4, `Expected four agent decisions, received ${routerCalls}`)
  assert(fastCalls === 0, `The unselected fast model ran ${fastCalls} time(s)`)
  assert(qualityCalls === 1, `Expected one quality-model call, received ${qualityCalls}`)
  assert(
    generationBodies.some((body) => body.includes(marker)),
    'The original user task was replaced before the generation model ran',
  )

  console.log(
    `[agent-routing-smoke] ${targetTriple} draft rejection, publish, restart, four-agent routing, and original-task preservation succeeded`,
  )
} finally {
  await sidecar?.stop()
  upstream.stop(true)
  await rm(temporaryHome, { recursive: true, force: true })
}

function buildGraph(routerId: string, fastId: string, qualityId: string) {
  const agentConfig = (
    instructions: string,
    inputPorts: Array<{ id: string; label: string; description: string }>,
    outputPorts: Array<{ id: string; label: string; description: string }>,
    fallbackOutputPortId: string,
  ) => ({
    providerId: routerId,
    modelId: 'router-model',
    inputPorts,
    outputPorts,
    instructions,
    fallbackOutputPortId,
    confidenceThreshold: 0.6,
    timeoutMs: 8_000,
    maxInputChars: 4_000,
  })

  return {
    version: 3 as const,
    source: 'user' as const,
    nodes: [
      { id: 'start', type: 'start', position: { x: 0, y: 0 }, config: {} },
      {
        id: 'planner',
        type: 'agent',
        position: { x: 220, y: 0 },
        config: agentConfig(
          'PLANNER_AGENT: decide whether another specialist should handle the task.',
          [{ id: 'task', label: 'Task', description: 'Original user task' }],
          [
            { id: 'delegate', label: 'Delegate', description: 'Use the implementation agent' },
            { id: 'direct', label: 'Direct', description: 'Use the fast model directly' },
          ],
          'direct',
        ),
      },
      {
        id: 'architect',
        type: 'agent',
        position: { x: 470, y: 0 },
        config: agentConfig(
          'ARCHITECT_AGENT: decide whether the task is ready for review.',
          [{ id: 'planned', label: 'Planned task', description: 'Task selected by the planner' }],
          [
            { id: 'continue', label: 'Continue', description: 'Send the task to the reviewer' },
            { id: 'direct', label: 'Direct', description: 'Use the fast model directly' },
          ],
          'direct',
        ),
      },
      {
        id: 'reviewer',
        type: 'agent',
        position: { x: 710, y: 0 },
        config: agentConfig(
          'REVIEWER_AGENT: decide whether the task is ready for implementation.',
          [{ id: 'architected', label: 'Architecture', description: 'Task prepared by the architect' }],
          [
            { id: 'continue', label: 'Continue', description: 'Send the task to the implementer' },
            { id: 'direct', label: 'Direct', description: 'Use the fast model directly' },
          ],
          'direct',
        ),
      },
      {
        id: 'implementer',
        type: 'agent',
        position: { x: 950, y: 0 },
        config: agentConfig(
          'IMPLEMENTER_AGENT: choose the implementation model.',
          [{ id: 'reviewed', label: 'Reviewed task', description: 'Task approved by the reviewer' }],
          [
            { id: 'fast', label: 'Fast', description: 'Use the faster model' },
            { id: 'quality', label: 'Quality', description: 'Use the stronger model' },
          ],
          'fast',
        ),
      },
      {
        id: 'fast-model',
        type: 'model',
        position: { x: 1210, y: -100 },
        config: { providerId: fastId, modelId: 'fast-model', timeoutMs: 30_000, maxAttempts: 1 },
      },
      {
        id: 'quality-model',
        type: 'model',
        position: { x: 1210, y: 100 },
        config: { providerId: qualityId, modelId: 'quality-model', timeoutMs: 30_000, maxAttempts: 1 },
      },
      { id: 'output', type: 'output', position: { x: 1450, y: 0 }, config: {} },
    ],
    edges: [
      { id: 'start-planner', source: 'start', target: 'planner', kind: 'flow', targetPortId: 'task' },
      {
        id: 'planner-delegate',
        source: 'planner',
        target: 'architect',
        kind: 'choice',
        sourcePortId: 'delegate',
        targetPortId: 'planned',
      },
      {
        id: 'planner-direct',
        source: 'planner',
        target: 'fast-model',
        kind: 'choice',
        sourcePortId: 'direct',
      },
      {
        id: 'architect-continue',
        source: 'architect',
        target: 'reviewer',
        kind: 'choice',
        sourcePortId: 'continue',
        targetPortId: 'architected',
      },
      {
        id: 'architect-direct',
        source: 'architect',
        target: 'fast-model',
        kind: 'choice',
        sourcePortId: 'direct',
      },
      {
        id: 'reviewer-continue',
        source: 'reviewer',
        target: 'implementer',
        kind: 'choice',
        sourcePortId: 'continue',
        targetPortId: 'reviewed',
      },
      {
        id: 'reviewer-direct',
        source: 'reviewer',
        target: 'fast-model',
        kind: 'choice',
        sourcePortId: 'direct',
      },
      {
        id: 'implementer-fast',
        source: 'implementer',
        target: 'fast-model',
        kind: 'choice',
        sourcePortId: 'fast',
      },
      {
        id: 'implementer-quality',
        source: 'implementer',
        target: 'quality-model',
        kind: 'choice',
        sourcePortId: 'quality',
      },
      { id: 'fast-output', source: 'fast-model', target: 'output', kind: 'flow' },
      { id: 'quality-output', source: 'quality-model', target: 'output', kind: 'flow' },
    ],
  }
}

async function putRoutingConfig(port: number, draftGraph: ReturnType<typeof buildGraph>) {
  const response = await apiFetch(port, '/api/routing/config', {
    method: 'PUT',
    body: JSON.stringify({
      version: 2,
      enabled: true,
      profiles: [{
        id: 'user-journey',
        name: 'User journey route',
        enabled: true,
        strategy: 'auto',
        strictFree: false,
        allowExperimental: false,
        maxAttempts: 8,
        targets: [],
        draftGraph,
      }],
    }),
  })
  const responseText = await response.text()
  assert(response.ok, `Draft save failed: HTTP ${response.status} ${responseText}`)
}

async function addProvider(port: number, name: string, apiKey: string, modelId: string) {
  const response = await apiFetch(port, '/api/providers', {
    method: 'POST',
    body: JSON.stringify({
      presetId: 'custom',
      name,
      apiKey,
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      apiFormat: 'openai_chat',
      models: { main: modelId, haiku: modelId, sonnet: modelId, opus: modelId },
      modelCatalog: [{ id: modelId }],
    }),
  })
  const payload = await response.json() as { provider?: { id?: string }; error?: unknown }
  assert(response.status === 201 && payload.provider?.id, `Provider creation failed: ${JSON.stringify(payload)}`)
  return payload.provider!.id!
}

async function startSidecar() {
  const port = await reserveLocalPort()
  const child = Bun.spawn(
    [
      executable!,
      'server',
      '--auth-required',
      '--app-root',
      repoRoot,
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: temporaryHome,
        USERPROFILE: temporaryHome,
        CYBER_CONFIG_DIR: path.join(temporaryHome, '.cyber'),
        CLAUDE_CONFIG_DIR: path.join(temporaryHome, '.cyber'),
        SERVER_AUTH_TOKEN: authToken,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const stdout = new Response(child.stdout).text()
  const stderr = new Response(child.stderr).text()
  let exited = false
  const exitPromise = child.exited.then((code) => {
    exited = true
    return code
  })
  // A cold standalone Bun executable can spend tens of seconds importing the
  // full desktop server on slower release runners.
  const deadline = Date.now() + 75_000

  while (Date.now() < deadline && !exited) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(500),
      })
      if (response.ok) {
        return {
          port,
          async stop() {
            child.kill()
            await exitPromise
            await Promise.all([stdout, stderr])
          },
        }
      }
    } catch {
      // The bundled server is still starting.
    }
    await Bun.sleep(100)
  }

  child.kill()
  await exitPromise
  const [stdoutText, stderrText] = await Promise.all([stdout, stderr])
  throw new Error(`Sidecar failed to start\n${stdoutText}\n${stderrText}`)
}

async function apiFetch(port: number, pathname: string, init: RequestInit = {}) {
  return fetch(`http://127.0.0.1:${port}${pathname}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${authToken}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })
}

async function apiJson<T>(port: number, pathname: string): Promise<T> {
  const response = await apiFetch(port, pathname)
  const text = await response.text()
  assert(response.ok, `API request failed: HTTP ${response.status} ${text}`)
  return JSON.parse(text) as T
}

function openAIResponse(model: string, content: string): Response {
  return Response.json({
    id: `chatcmpl-${model}`,
    object: 'chat.completion',
    created: 1,
    model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
  })
}

async function reserveLocalPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Unable to reserve a local port')
  const port = address.port
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[agent-routing-smoke] ${message}`)
}
