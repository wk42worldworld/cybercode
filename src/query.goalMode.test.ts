import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  addInvokedSkill,
  resetStateForTests,
} from './bootstrap/state.js'
import { query } from './query.js'
import type { QueryDeps } from './query/deps.js'
import {
  GOAL_MODE_MARKER,
  GOAL_STATUS_TOOL_NAME,
  isGoalModeActive,
} from './skills/goalMode.js'
import { getDefaultAppState } from './state/AppStateStore.js'
import type { ToolUseContext } from './Tool.js'
import { GoalStatusTool } from './tools/GoalStatusTool/GoalStatusTool.js'
import { createFileStateCacheWithSizeLimit } from './utils/fileStateCache.js'
import {
  createAssistantMessage,
  createUserMessage,
} from './utils/messages.js'
import { asSystemPrompt } from './utils/systemPromptType.js'

describe('query Goal mode loop', () => {
  beforeEach(() => {
    resetStateForTests()
  })

  afterEach(() => {
    resetStateForTests()
  })

  test('continues partial answers and exits only after GoalStatus resolution', async () => {
    addInvokedSkill(
      'goal',
      'bundled:goal',
      `${GOAL_MODE_MARKER}\nfinish the task`,
      null,
    )

    const initialMessage = createUserMessage({ content: 'finish the task' })
    let appState = getDefaultAppState()
    let modelCallCount = 0
    const modelInputs: unknown[] = []
    const deps: QueryDeps = {
      uuid: () => `query-${modelCallCount}`,
      microcompact: (async messages => ({
        messages,
      })) as QueryDeps['microcompact'],
      autocompact: (async () => ({
        wasCompacted: false,
      })) as QueryDeps['autocompact'],
      compactOnPromptTooLong: (async () =>
        null) as QueryDeps['compactOnPromptTooLong'],
      callModel: (async function* (input) {
        modelCallCount++
        modelInputs.push(input.messages)

        if (modelCallCount === 1) {
          yield createAssistantMessage({
            content: 'The implementation looks complete.',
          })
          return
        }

        if (modelCallCount === 2) {
          yield createAssistantMessage({
            content: [
              {
                type: 'tool_use',
                id: 'goal-status-1',
                name: GOAL_STATUS_TOOL_NAME,
                input: {
                  status: 'complete',
                  summary: 'Focused tests and the production build passed.',
                },
              },
            ] as never,
          })
          return
        }

        yield createAssistantMessage({
          content: 'Finished and verified.',
        })
      }) as QueryDeps['callModel'],
    }
    const toolUseContext = {
      options: {
        commands: [],
        debug: false,
        mainLoopModel: 'claude-sonnet-4-5-20250929',
        tools: [GoalStatusTool],
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

    const generator = query({
      messages: [initialMessage],
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool: (async (_tool, input) => ({
        behavior: 'allow',
        updatedInput: input,
      })) as never,
      toolUseContext,
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

    expect(modelCallCount).toBe(3)
    expect(JSON.stringify(modelInputs[1])).toContain(
      'Goal Mode remains active',
    )
    expect(JSON.stringify(yielded)).toContain('Finished and verified.')
    expect(terminal).toEqual({ reason: 'completed' })
    expect(isGoalModeActive(null)).toBe(false)
  })
})
