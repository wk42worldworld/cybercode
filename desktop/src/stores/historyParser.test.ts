import { describe, it, expect } from 'vitest'
import {
  mapHistoryMessages,
  reconstructAgentNotifications,
  parseHistory,
} from './historyParser'
import type { MessageEntry } from '../types/session'

let counter = 0
const idGen = () => `t-${++counter}`

describe('historyParser.mapHistoryMessages', () => {
  it('preserves thinking blocks and tool linkage', () => {
    const messages: MessageEntry[] = [
      {
        id: 'assistant-1',
        type: 'assistant',
        timestamp: '2026-04-06T00:00:00.000Z',
        model: 'opus',
        parentToolUseId: 'agent-1',
        content: [
          { type: 'thinking', thinking: 'internal reasoning' },
          { type: 'text', text: '目录结构分析' },
          { type: 'tool_use', name: 'Read', id: 'tool-1', input: { file_path: 'src/App.tsx' } },
        ],
      },
      {
        id: 'user-1',
        type: 'user',
        timestamp: '2026-04-06T00:00:01.000Z',
        parentToolUseId: 'agent-1',
        content: [
          { type: 'tool_result', tool_use_id: 'tool-1', content: 'ok', is_error: false },
        ],
      },
    ]

    const mapped = mapHistoryMessages(messages, idGen)

    expect(mapped.map((m) => m.type)).toEqual([
      'thinking',
      'assistant_text',
      'tool_use',
      'tool_result',
    ])
    expect(mapped[2]).toMatchObject({ parentToolUseId: 'agent-1' })
    expect(mapped[3]).toMatchObject({ parentToolUseId: 'agent-1' })
  })

  it('merges consecutive assistant text blocks', () => {
    const messages: MessageEntry[] = [
      {
        id: 'assistant-merge-1',
        type: 'assistant',
        timestamp: '2026-04-06T00:00:00.000Z',
        model: 'opus',
        content: [
          { type: 'text', text: '第一段：Windows 下的桌面端输出。' },
          { type: 'text', text: '\r\n第二段：刷新后也不应该被拆开。' },
        ],
      },
    ]

    const mapped = mapHistoryMessages(messages, idGen)

    expect(mapped).toMatchObject([
      {
        type: 'assistant_text',
        content: '第一段：Windows 下的桌面端输出。\r\n第二段：刷新后也不应该被拆开。',
      },
    ])
  })

  it('hides teammate-message wrappers by default', () => {
    const messages: MessageEntry[] = [
      {
        id: 'user-1',
        type: 'user',
        timestamp: '2026-04-06T00:00:00.000Z',
        content: '<teammate-message teammate_id="reviewer">Look at this.</teammate-message>',
      },
    ]

    expect(mapHistoryMessages(messages, idGen)).toEqual([])
  })

  it('surfaces teammate prompt content when includeTeammateMessages=true', () => {
    const messages: MessageEntry[] = [
      {
        id: 'user-1',
        type: 'user',
        timestamp: '2026-04-06T00:00:00.000Z',
        content:
          '<teammate-message teammate_id="security-reviewer">Review the auth diff and call out risks.</teammate-message>',
      },
    ]

    const mapped = mapHistoryMessages(messages, idGen, { includeTeammateMessages: true })

    expect(mapped).toMatchObject([
      {
        type: 'user_text',
        content: 'Review the auth diff and call out risks.',
      },
    ])
  })

  it('skips lifecycle JSON teammate messages', () => {
    const text =
      '<teammate-message teammate_id="reviewer">{"type":"shutdown_approved"}</teammate-message>'
    const messages: MessageEntry[] = [
      { id: 'u', type: 'user', timestamp: '2026-04-06T00:00:00.000Z', content: text },
    ]
    expect(mapHistoryMessages(messages, idGen, { includeTeammateMessages: true })).toEqual([])
  })

  it('wraps raw base64 image data into a data: URL on history restore', () => {
    const messages: MessageEntry[] = [
      {
        id: 'user-image',
        type: 'user',
        timestamp: '2026-04-06T00:00:00.000Z',
        content: [
          {
            type: 'image',
            name: 'screenshot.jpg',
            source: { data: '/9j/4AAQSkZJRgABAQAA' },
            media_type: 'image/jpeg',
          },
        ],
      },
    ]

    const mapped = mapHistoryMessages(messages, idGen)
    const attachment = (mapped[0] as { attachments?: Array<{ data?: string }> }).attachments?.[0]
    expect(attachment?.data).toBe('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAA')
  })

  it('leaves already-prefixed data URLs untouched on history restore', () => {
    const messages: MessageEntry[] = [
      {
        id: 'user-image',
        type: 'user',
        timestamp: '2026-04-06T00:00:00.000Z',
        content: [
          {
            type: 'image',
            name: 'pasted.png',
            source: { data: 'data:image/png;base64,iVBORw0KGgo=' },
            media_type: 'image/png',
          },
        ],
      },
    ]

    const mapped = mapHistoryMessages(messages, idGen)
    const attachment = (mapped[0] as { attachments?: Array<{ data?: string }> }).attachments?.[0]
    expect(attachment?.data).toBe('data:image/png;base64,iVBORw0KGgo=')
  })

  it('preserves source user ids on array-content user prompts with attachments', () => {
    const messages: MessageEntry[] = [
      {
        id: 'user-with-attachment',
        type: 'user',
        timestamp: '2026-04-06T00:00:00.000Z',
        content: [
          { type: 'text', text: '请看这个文件' },
          { type: 'file', name: 'report.md' },
        ],
      },
    ]

    const mapped = mapHistoryMessages(messages, idGen)

    expect(mapped).toMatchObject([
      {
        id: 'user-with-attachment',
        type: 'user_text',
        content: '请看这个文件',
        attachments: [{ type: 'file', name: 'report.md' }],
      },
    ])
  })

  it('uses idGen only when source message lacks id', () => {
    counter = 0
    const messages: MessageEntry[] = [
      {
        id: '',
        type: 'user',
        timestamp: '2026-04-06T00:00:00.000Z',
        content: 'no source id',
      },
      {
        id: 'has-id',
        type: 'user',
        timestamp: '2026-04-06T00:00:00.000Z',
        content: 'with id',
      },
    ]

    const mapped = mapHistoryMessages(messages, idGen)
    expect(mapped[0]?.id).toBe('t-1')
    expect(mapped[1]?.id).toBe('has-id')
  })
})

describe('historyParser.reconstructAgentNotifications', () => {
  it('correlates Agent tool_use names with subsequent teammate-message replies', () => {
    const messages: MessageEntry[] = [
      {
        id: 'a-1',
        type: 'assistant',
        timestamp: '2026-04-06T00:00:00.000Z',
        content: [
          {
            type: 'tool_use',
            name: 'Agent',
            id: 'tool-agent-1',
            input: { name: 'security-reviewer', task: 'review auth' },
          },
        ],
      },
      {
        id: 'u-1',
        type: 'user',
        timestamp: '2026-04-06T00:00:10.000Z',
        content:
          '<teammate-message teammate_id="security-reviewer">Found 2 issues with token storage.</teammate-message>',
      },
    ]

    const result = reconstructAgentNotifications(messages)
    expect(result['tool-agent-1']).toMatchObject({
      taskId: 'tool-agent-1',
      toolUseId: 'tool-agent-1',
      status: 'completed',
      summary: 'Found 2 issues with token storage.',
    })
  })

  it('returns empty when no Agent tool_use exists', () => {
    const messages: MessageEntry[] = [
      {
        id: 'u-1',
        type: 'user',
        timestamp: '2026-04-06T00:00:00.000Z',
        content: 'hello',
      },
    ]
    expect(reconstructAgentNotifications(messages)).toEqual({})
  })

  it('skips lifecycle teammate replies and keeps the first real one', () => {
    const messages: MessageEntry[] = [
      {
        id: 'a-1',
        type: 'assistant',
        timestamp: '2026-04-06T00:00:00.000Z',
        content: [
          {
            type: 'tool_use',
            name: 'Agent',
            id: 'tool-agent-1',
            input: { name: 'reviewer' },
          },
        ],
      },
      {
        id: 'u-1',
        type: 'user',
        timestamp: '2026-04-06T00:00:10.000Z',
        content:
          '<teammate-message teammate_id="reviewer">Review complete: LGTM.</teammate-message>',
      },
      {
        id: 'u-2',
        type: 'user',
        timestamp: '2026-04-06T00:00:20.000Z',
        content:
          '<teammate-message teammate_id="reviewer">{"type":"idle_notification"}</teammate-message>',
      },
    ]

    const result = reconstructAgentNotifications(messages)
    expect(result['tool-agent-1']?.summary).toBe('Review complete: LGTM.')
  })
})

describe('historyParser.parseHistory', () => {
  it('returns the combined parse result shape', () => {
    const messages: MessageEntry[] = [
      {
        id: 'a-1',
        type: 'assistant',
        timestamp: '2026-04-06T00:00:00.000Z',
        content: [
          {
            type: 'tool_use',
            name: 'TodoWrite',
            id: 'todo-1',
            input: {
              todos: [
                { content: 'do thing', status: 'pending', activeForm: 'doing thing' },
              ],
            },
          },
        ],
      },
    ]

    const result = parseHistory(messages, idGen)
    expect(result).toMatchObject({
      uiMessages: expect.any(Array),
      restoredNotifications: {},
      lastTodos: [{ content: 'do thing', status: 'pending' }],
      hasMessagesAfterTaskCompletion: false,
    })
  })
})
