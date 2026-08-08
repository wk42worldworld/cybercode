import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { resetStateForTests } from './bootstrap/state.js'
import { query } from './query.js'
import type { QueryDeps } from './query/deps.js'
import type { CompactionResult } from './services/compact/compact.js'
import {
  PROMPT_TOO_LONG_ERROR_MESSAGE,
  isPromptTooLongMessage,
} from './services/api/errors.js'
import { getDefaultAppState } from './state/AppStateStore.js'
import type { ToolUseContext } from './Tool.js'
import { createFileStateCacheWithSizeLimit } from './utils/fileStateCache.js'
import {
  createAssistantAPIErrorMessage,
  createAssistantMessage,
  createCompactBoundaryMessage,
  createUserMessage,
} from './utils/messages.js'
import { asSystemPrompt } from './utils/systemPromptType.js'

function createToolUseContext(initialMessage: ReturnType<typeof createUserMessage>) {
  let appState = getDefaultAppState()
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'smaller-provider-model',
      tools: [],
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: true,
      agentDefinitions: { activeAgents: [], allAgents: [] },
    },
    abortController: new AbortController(),
    readFileState: createFileStateCacheWithSizeLimit(10),
    getAppState: () => appState,
    setAppState: update => {
      appState = update(appState)
    },
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    messages: [initialMessage],
  } as ToolUseContext
}

function createCompactionResult(
  initialMessage: ReturnType<typeof createUserMessage>,
): CompactionResult {
  return {
    boundaryMarker: createCompactBoundaryMessage(
      'auto',
      120_000,
      initialMessage.uuid,
    ),
    summaryMessages: [
      createUserMessage({
        content: 'Compacted conversation summary',
        isCompactSummary: true,
      }),
    ],
    attachments: [],
    hookResults: [],
  }
}

async function drainQuery(
  deps: QueryDeps,
  initialMessage: ReturnType<typeof createUserMessage>,
) {
  const generator = query({
    messages: [initialMessage],
    systemPrompt: asSystemPrompt([]),
    userContext: {},
    systemContext: {},
    canUseTool: (async (_tool, input) => ({
      behavior: 'allow',
      updatedInput: input,
    })) as never,
    toolUseContext: createToolUseContext(initialMessage),
    querySource: 'sdk',
    deps,
  })

  const yielded: unknown[] = []
  let terminal: unknown
  while (true) {
    const next = await generator.next()
    if (next.done) {
      terminal = next.value
      break
    }
    yielded.push(next.value)
  }
  return { yielded, terminal }
}

describe('query prompt-too-long recovery', () => {
  beforeEach(() => {
    resetStateForTests()
    delete process.env.DISABLE_COMPACT
    delete process.env.DISABLE_AUTO_COMPACT
  })

  afterEach(() => {
    resetStateForTests()
  })

  test('compacts and retries when a switched model rejects the existing context', async () => {
    const initialMessage = createUserMessage({ content: 'Continue this chat' })
    let modelCallCount = 0
    let compactCallCount = 0
    const modelInputs: unknown[] = []
    const deps: QueryDeps = {
      uuid: () => `query-${modelCallCount}`,
      microcompact: (async messages => ({
        messages,
      })) as QueryDeps['microcompact'],
      autocompact: (async () => ({
        wasCompacted: false,
      })) as QueryDeps['autocompact'],
      compactOnPromptTooLong: (async () => {
        compactCallCount++
        return createCompactionResult(initialMessage)
      }) as QueryDeps['compactOnPromptTooLong'],
      callModel: (async function* (input) {
        modelCallCount++
        modelInputs.push(input.messages)
        if (modelCallCount === 1) {
          yield createAssistantAPIErrorMessage({
            content: PROMPT_TOO_LONG_ERROR_MESSAGE,
            error: 'invalid_request',
          })
          return
        }
        yield createAssistantMessage({ content: 'Recovered response' })
      }) as QueryDeps['callModel'],
    }

    const { yielded, terminal } = await drainQuery(deps, initialMessage)

    expect(modelCallCount).toBe(2)
    expect(compactCallCount).toBe(1)
    expect(JSON.stringify(modelInputs[1])).toContain(
      'Compacted conversation summary',
    )
    expect(JSON.stringify(yielded)).toContain('Recovered response')
    expect(
      yielded.some(
        message =>
          typeof message === 'object' &&
          message !== null &&
          isPromptTooLongMessage(message as never),
      ),
    ).toBe(false)
    expect(terminal).toEqual({ reason: 'completed' })
  })

  test('surfaces one error without looping when the compacted retry is still too long', async () => {
    const initialMessage = createUserMessage({ content: 'Continue this chat' })
    let modelCallCount = 0
    let compactCallCount = 0
    const deps: QueryDeps = {
      uuid: () => `query-${modelCallCount}`,
      microcompact: (async messages => ({
        messages,
      })) as QueryDeps['microcompact'],
      autocompact: (async () => ({
        wasCompacted: false,
      })) as QueryDeps['autocompact'],
      compactOnPromptTooLong: (async () => {
        compactCallCount++
        return createCompactionResult(initialMessage)
      }) as QueryDeps['compactOnPromptTooLong'],
      callModel: (async function* () {
        modelCallCount++
        yield createAssistantAPIErrorMessage({
          content: PROMPT_TOO_LONG_ERROR_MESSAGE,
          error: 'invalid_request',
        })
      }) as QueryDeps['callModel'],
    }

    const { yielded, terminal } = await drainQuery(deps, initialMessage)
    const promptTooLongMessages = yielded.filter(
      message =>
        typeof message === 'object' &&
        message !== null &&
        isPromptTooLongMessage(message as never),
    )

    expect(modelCallCount).toBe(2)
    expect(compactCallCount).toBe(1)
    expect(promptTooLongMessages).toHaveLength(1)
    expect(terminal).toEqual({ reason: 'prompt_too_long' })
  })

  test('also recovers providers that throw prompt-too-long errors', async () => {
    const initialMessage = createUserMessage({ content: 'Continue this chat' })
    let modelCallCount = 0
    let compactCallCount = 0
    const deps: QueryDeps = {
      uuid: () => `query-${modelCallCount}`,
      microcompact: (async messages => ({
        messages,
      })) as QueryDeps['microcompact'],
      autocompact: (async () => ({
        wasCompacted: false,
      })) as QueryDeps['autocompact'],
      compactOnPromptTooLong: (async () => {
        compactCallCount++
        return createCompactionResult(initialMessage)
      }) as QueryDeps['compactOnPromptTooLong'],
      callModel: (async function* () {
        modelCallCount++
        if (modelCallCount === 1) {
          throw new Error('API Error: Prompt is too long')
        }
        yield createAssistantMessage({ content: 'Recovered thrown error' })
      }) as QueryDeps['callModel'],
    }

    const { yielded, terminal } = await drainQuery(deps, initialMessage)

    expect(modelCallCount).toBe(2)
    expect(compactCallCount).toBe(1)
    expect(JSON.stringify(yielded)).toContain('Recovered thrown error')
    expect(terminal).toEqual({ reason: 'completed' })
  })
})
