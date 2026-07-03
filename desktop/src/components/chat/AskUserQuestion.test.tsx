import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
}))

vi.mock('../../api/websocket', () => ({
  wsManager: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    clearHandlers: vi.fn(),
    send: sendMock,
  },
}))

vi.mock('../../api/sessions', () => ({
  sessionsApi: {
    getMessages: vi.fn(async () => ({ messages: [] })),
    getSlashCommands: vi.fn(async () => ({ commands: [] })),
  },
}))

import { AskUserQuestion } from './AskUserQuestion'
import { useChatStore } from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'

const ACTIVE_TAB = 'active-tab'

const singleQuestionInput = {
  questions: [
    {
      question: 'Should we persist data?',
      options: [{ label: 'No' }, { label: 'Yes' }],
    },
  ],
}

const multiQuestionInput = {
  questions: [
    {
      header: 'Persist',
      question: 'Should we persist data?',
      options: [{ label: 'No' }, { label: 'Yes' }],
    },
    {
      header: 'Storage',
      question: 'Where should we store it?',
      options: [{ label: 'Local' }, { label: 'Cloud' }],
    },
  ],
}

function setPendingInput(input: unknown) {
  const state = useChatStore.getState()
  const session = state.sessions[ACTIVE_TAB]
  if (!session) throw new Error('Expected active test session')

  useChatStore.setState({
    sessions: {
      ...state.sessions,
      [ACTIVE_TAB]: {
        ...session,
        pendingPermission: {
          requestId: 'perm-1',
          toolName: 'AskUserQuestion',
          toolUseId: 'tool-1',
          input,
        },
      },
    },
  })
}

describe('AskUserQuestion', () => {
  beforeEach(() => {
    sendMock.mockReset()
    useTabStore.setState({
      activeTabId: ACTIVE_TAB,
      tabs: [{ sessionId: ACTIVE_TAB, title: 'Test', type: 'session', status: 'idle' }],
    })
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: {
          messages: [],
          historyBuffer: [],
          recentBuffer: [],
          chatState: 'permission_pending',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: {
            requestId: 'perm-1',
            toolName: 'AskUserQuestion',
            toolUseId: 'tool-1',
            input: singleQuestionInput,
          },
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })
  })

  it('submits answers through permission_response updatedInput instead of sending a chat message', () => {
    render(
      <AskUserQuestion
        toolUseId="tool-1"
        input={singleQuestionInput}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /^No$/ }))
    fireEvent.click(screen.getByRole('button', { name: /提交|submit/i }))

    expect(sendMock).toHaveBeenCalledWith(ACTIVE_TAB, {
      type: 'permission_response',
      requestId: 'perm-1',
      allowed: true,
      updatedInput: {
        ...singleQuestionInput,
        answers: {
          'Should we persist data?': 'No',
        },
      },
    })
  })

  it('keeps an option answer when another tab uses a custom answer', () => {
    setPendingInput(multiQuestionInput)

    render(
      <AskUserQuestion
        toolUseId="tool-1"
        input={multiQuestionInput}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /^No$/ }))
    fireEvent.click(screen.getByRole('button', { name: /Storage/ }))
    fireEvent.change(screen.getByPlaceholderText(/输入你的回答|type your answer/i), {
      target: { value: 'Use encrypted cache' },
    })
    fireEvent.click(screen.getByRole('button', { name: /提交|submit/i }))

    expect(sendMock).toHaveBeenCalledWith(ACTIVE_TAB, {
      type: 'permission_response',
      requestId: 'perm-1',
      allowed: true,
      updatedInput: {
        ...multiQuestionInput,
        answers: {
          'Should we persist data?': 'No',
          'Where should we store it?': 'Use encrypted cache',
        },
      },
    })
  })

  it('keeps a custom answer when another tab uses an option answer', () => {
    setPendingInput(multiQuestionInput)

    render(
      <AskUserQuestion
        toolUseId="tool-1"
        input={multiQuestionInput}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText(/输入你的回答|type your answer/i), {
      target: { value: 'Ask every time' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Storage/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Cloud$/ }))
    fireEvent.click(screen.getByRole('button', { name: /提交|submit/i }))

    expect(sendMock).toHaveBeenCalledWith(ACTIVE_TAB, {
      type: 'permission_response',
      requestId: 'perm-1',
      allowed: true,
      updatedInput: {
        ...multiQuestionInput,
        answers: {
          'Should we persist data?': 'Ask every time',
          'Where should we store it?': 'Cloud',
        },
      },
    })
  })
})
