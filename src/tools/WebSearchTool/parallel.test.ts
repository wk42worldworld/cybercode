import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { getSessionId, regenerateSessionId, switchSession } from '../../bootstrap/state.js'
import type { ToolUseContext } from '../../Tool.js'
import { clearOAuthTokenCache, getApiKeyFromConfigOrMacOSKeychain } from '../../utils/auth.js'
import { enableConfigs, saveGlobalConfig } from '../../utils/config.js'
import { shouldUseParallelWebSearch } from '../../services/webSearch/searchMode.js'
import { WebSearchTool } from './WebSearchTool.js'
import { runToolUse } from '../../services/tools/toolExecution.js'
import { getDefaultAppState } from '../../state/AppStateStore.js'
import { createAssistantMessage } from '../../utils/messages.js'
import { createAgentId } from '../../utils/uuid.js'
import { plainTextStorage } from '../../utils/secureStorage/plainTextStorage.js'
import { resetSettingsCache, setSessionSettingsCache } from '../../utils/settings/settingsCache.js'

const envKeys = [
  'CYBERCODE_WEB_SEARCH_MODE', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR', 'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR',
  'CLAUDE_CODE_API_KEY_HELPER', 'CLAUDE_CODE_REMOTE',
]
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]))
const originalFetch = globalThis.fetch
const hits = [
  { title: 'Bun documentation', url: 'https://bun.sh/docs', excerpts: ['Run TypeScript with Bun.'] },
  { title: 'Subdomain', url: 'https://api.bun.sh/docs', excerpts: ['API documentation.'] },
  { title: 'Other', url: 'https://example.com/other', excerpts: ['Other source.'] },
  { title: 'Unsafe', url: 'javascript:alert(1)', excerpts: [] },
  { title: 'Credentials', url: 'https://user:secret@example.com/', excerpts: [] },
  { title: 'Duplicate', url: 'https://bun.sh/docs', excerpts: [] },
]
type Request = { url: string; headers: Headers; method?: string; params?: any }
let requests: Request[] = []
let toolResult: any
let hangingMethod: string | undefined
let httpStatus = 200

function installMcpFixture() {
  globalThis.fetch = (async (url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    requests.push({ url: String(url), headers: new Headers(init?.headers), ...body })
    if (body.method === hangingMethod) {
      return await new Promise<Response>((_resolve, reject) => {
        const signal = init!.signal!
        if (signal.aborted) reject(signal.reason)
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    }
    if (!body.id && body.id !== 0) return new Response(null, { status: 202 })
    if (httpStatus !== 200) return new Response('Search service unavailable', { status: httpStatus })
    const result = body.method === 'initialize'
      ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
      : toolResult
    return Response.json({ jsonrpc: '2.0', id: body.id, result })
  }) as typeof fetch
}

function context(agentId?: string, controller = new AbortController()): ToolUseContext {
  return { abortController: controller, agentId } as ToolUseContext
}

async function search(input: { query: string; allowed_domains?: string[]; blocked_domains?: string[] } = { query: 'Bun TypeScript documentation' }, ctx = context()) {
  return WebSearchTool.call(input, ctx, undefined as never, undefined as never)
}

beforeEach(() => {
  for (const key of envKeys) delete process.env[key]
  clearOAuthTokenCache()
  getApiKeyFromConfigOrMacOSKeychain.cache.clear()
  requests = []
  hangingMethod = undefined
  httpStatus = 200
  toolResult = { content: [{ type: 'text', text: JSON.stringify({ results: hits }) }] }
  installMcpFixture()
})

afterEach(() => {
  globalThis.fetch = originalFetch
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('Parallel through the built-in WebSearch tool', () => {
  test('fresh no-key configuration returns linked results to the model', async () => {
    expect(shouldUseParallelWebSearch()).toBe(true)
    const result = await search()
    const output = WebSearchTool.mapToolResultToToolResultBlockParam(result.data, 'test-tool')
    expect(output.content).toContain('https://bun.sh/docs')
    expect(output.content).toContain('Run TypeScript with Bun.')
    expect(output.content).not.toContain('javascript:')
    expect(output.content).not.toContain('user:secret')
    expect(result.data.results[0]).toMatchObject({ content: [
      { title: 'Bun documentation', engine: 'parallel' },
      { title: 'Subdomain', engine: 'parallel' },
      { title: 'Other', engine: 'parallel' },
    ] })
    expect(requests.some(r => r.method === 'initialize')).toBe(true)
    expect(requests.some(r => r.method === 'tools/call')).toBe(true)
    for (const request of requests) {
      expect(request.url).toBe('https://search.parallel.ai/mcp')
      expect(request.headers.get('User-Agent')).toContain('CyberCode/')
      expect(request.headers.has('Authorization')).toBe(false)
    }
    expect(requests.find(r => r.method === 'tools/call')?.params).toEqual({
      name: 'web_search',
      arguments: { objective: 'Bun TypeScript documentation', search_queries: ['Bun TypeScript documentation'], session_id: getSessionId() },
    })
  })

  test('filters allowed subdomains and blocked domains before model consumption', async () => {
    const allowed = await search({ query: 'Bun docs', allowed_domains: ['bun.sh'] })
    const content = WebSearchTool.mapToolResultToToolResultBlockParam(allowed.data, 'allowed').content
    expect(content).toContain('https://api.bun.sh/docs')
    expect(content).not.toContain('example.com')
    expect(requests.find(r => r.method === 'tools/call')?.params.arguments.search_queries).toEqual(['Bun docs (site:bun.sh)'])
    const blocked = await search({ query: 'Bun docs', blocked_domains: ['bun.sh'] })
    const filtered = WebSearchTool.mapToolResultToToolResultBlockParam(blocked.data, 'blocked').content
    expect(filtered).not.toContain('https://bun.sh')
    expect(filtered).not.toContain('https://api.bun.sh')
    expect(filtered).toContain('https://example.com/other')
  })

  test('accepts structured MCP output and empty results', async () => {
    toolResult = { content: [], structuredContent: { results: [] } }
    const result = await search()
    expect(WebSearchTool.mapToolResultToToolResultBlockParam(result.data, 'empty').content).toContain('No links found.')
  })

  test('reports MCP errors and malformed responses without falling back', async () => {
    process.env.CYBERCODE_WEB_SEARCH_MODE = 'parallel'
    toolResult = { content: [{ type: 'text', text: 'Anonymous quota exceeded' }], isError: true }
    await expect(search()).rejects.toThrow('Anonymous quota exceeded')
    toolResult = { content: [{ type: 'text', text: '{"unexpected":true}' }] }
    await expect(search()).rejects.toThrow()
    expect(requests.every(r => r.url === 'https://search.parallel.ai/mcp')).toBe(true)
  })

  test('surfaces HTTP failures without another backend request', async () => {
    httpStatus = 503
    await expect(search()).rejects.toThrow()
    expect(requests.every(r => r.url === 'https://search.parallel.ai/mcp')).toBe(true)
  })

  test('cancels discovery and search, and does not start an already-aborted call', async () => {
    const aborted = new AbortController()
    aborted.abort()
    await expect(search(undefined, context(undefined, aborted))).rejects.toThrow()
    expect(requests).toHaveLength(0)
    for (const method of ['initialize', 'tools/call']) {
      hangingMethod = method
      const controller = new AbortController()
      const pending = search(undefined, context(undefined, controller))
      await Bun.sleep(10)
      controller.abort()
      await expect(pending).rejects.toThrow()
    }
  })

  test('bounds the whole operation including discovery to 15 seconds', async () => {
    const timeout = AbortSignal.timeout.bind(AbortSignal)
    const timeoutSpy = spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
      expect(ms).toBe(15_000)
      return timeout(10)
    })
    try {
      for (const method of ['initialize', 'tools/call']) {
        hangingMethod = method
        await expect(search()).rejects.toThrow()
      }
    } finally {
      timeoutSpy.mockRestore()
    }
  })

  test('keeps conversation identity on follow-up, retry and concurrent subagent calls', async () => {
    await search()
    await search()
    const id = getSessionId()
    toolResult = { content: [{ type: 'text', text: 'Quota exceeded' }], isError: true }
    await expect(search()).rejects.toThrow()
    toolResult = { content: [{ type: 'text', text: JSON.stringify({ results: hits }) }] }
    await search()
    expect(requests.filter(r => r.method === 'tools/call').map(r => r.params.arguments.session_id)).toEqual([id, id, id, id])
    requests = []
    const agentA = createAgentId()
    const agentB = createAgentId()
    await Promise.all([search(undefined, context(agentA)), search(undefined, context(agentB))])
    regenerateSessionId()
    await Promise.all([search(undefined, context(agentB)), search(undefined, context(agentA))])
    const ids = requests.filter(r => r.method === 'tools/call').map(r => r.params.arguments.session_id)
    expect(ids[0]).not.toBe(ids[1])
    expect(ids[0]).toBe(ids[3])
    expect(ids[1]).toBe(ids[2])
    expect(ids[0]).toMatch(/^[a-f0-9]{64}$/)
  })

  test('snapshots independent sessions before await and changes identity on new chat', async () => {
    const firstId = getSessionId()
    const first = search()
    const secondId = regenerateSessionId()
    const second = search()
    await Promise.all([first, second])
    const ids = requests.filter(r => r.method === 'tools/call').map(r => r.params.arguments.session_id)
    expect(ids).toEqual([firstId, secondId])
    expect(secondId).not.toBe(firstId)
    switchSession(firstId)
    await search()
    expect(requests.filter(r => r.method === 'tools/call').at(-1)?.params.arguments.session_id).toBe(firstId)
  })
})

describe('preserved search choices', () => {
  test('explicit modes override automatic selection', () => {
    for (const mode of ['local', 'native']) {
      process.env.CYBERCODE_WEB_SEARCH_MODE = mode
      expect(shouldUseParallelWebSearch()).toBe(false)
    }
    process.env.ANTHROPIC_API_KEY = 'configured-test-key'
    process.env.CYBERCODE_WEB_SEARCH_MODE = ' Parallel '
    expect(shouldUseParallelWebSearch()).toBe(true)
  })

  test('keeps configured endpoints, cloud providers and environment credentials', () => {
    for (const key of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) {
      process.env[key] = key === 'ANTHROPIC_BASE_URL' ? 'https://custom.example/anthropic' : '1'
      clearOAuthTokenCache()
      expect(shouldUseParallelWebSearch()).toBe(false)
      delete process.env[key]
      clearOAuthTokenCache()
    }
  })

  test('keeps saved OAuth and helper configuration without executing the helper', () => {
    expect(plainTextStorage.update({ claudeAiOauth: {
      accessToken: 'saved-test-oauth', scopes: ['user:inference'],
    } }).success).toBe(true)
    clearOAuthTokenCache()
    try {
      expect(shouldUseParallelWebSearch()).toBe(false)
    } finally {
      plainTextStorage.delete()
      clearOAuthTokenCache()
    }
    setSessionSettingsCache({ settings: { apiKeyHelper: 'exit 99' }, errors: [] })
    try {
      expect(shouldUseParallelWebSearch()).toBe(false)
      expect(requests).toHaveLength(0)
    } finally {
      resetSettingsCache()
    }
  })

  test('keeps saved API credentials', () => {
    enableConfigs()
    saveGlobalConfig(config => ({ ...config, primaryApiKey: 'saved-test-key' }))
    getApiKeyFromConfigOrMacOSKeychain.cache.clear()
    try {
      expect(shouldUseParallelWebSearch()).toBe(false)
    } finally {
      saveGlobalConfig(config => ({ ...config, primaryApiKey: undefined }))
      getApiKeyFromConfigOrMacOSKeychain.cache.clear()
    }
  })
})


describe('normal tool dispatcher permissions', () => {
  async function dispatch(available: boolean, allowed: boolean) {
    let appState = getDefaultAppState()
    const toolUse = { type: 'tool_use' as const, id: 'dispatch-search', name: 'WebSearch', input: { query: 'Bun TypeScript documentation' } }
    const assistant = createAssistantMessage({ content: [toolUse] })
    const ctx = {
      ...context(),
      options: {
        tools: available ? [WebSearchTool] : [], commands: [], debug: false,
        mainLoopModel: 'test-model', verbose: false,
        thinkingConfig: { type: 'disabled' }, mcpClients: [], mcpResources: {},
        isNonInteractiveSession: true, agentDefinitions: { activeAgents: [], allAgents: [] },
      },
      getAppState: () => appState,
      setAppState: update => { appState = update(appState) },
      setInProgressToolUseIDs: () => {}, setResponseLength: () => {},
      updateFileHistoryState: () => {}, updateAttributionState: () => {},
      messages: [assistant],
    } as ToolUseContext
    const updates = []
    for await (const update of runToolUse(toolUse, assistant, async (_tool, input) => allowed
      ? { behavior: 'allow', updatedInput: input }
      : { behavior: 'deny', message: 'Search denied for this session.' }, ctx)) {
      updates.push(update)
    }
    return JSON.stringify(updates)
  }

  test('denied or unavailable WebSearch sends no MCP request', async () => {
    expect(await dispatch(true, false)).toContain('Search denied for this session.')
    expect(requests).toHaveLength(0)
    expect(await dispatch(false, true)).toContain('No such tool available')
    expect(requests).toHaveLength(0)
  })

  test('authorized WebSearch dispatch returns source links', async () => {
    const output = await dispatch(true, true)
    expect(output).toContain('https://bun.sh/docs')
    expect(output).toContain('Run TypeScript with Bun.')
    expect(output).not.toContain('tool_use_error')
    expect(requests.some(r => r.method === 'tools/call')).toBe(true)
  })
})
