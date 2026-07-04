import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { PendingSteerBar } from './PendingSteerBar'
import { useChatStore, type PerSessionState } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'

function makeChatSession(overrides: Partial<PerSessionState> = {}): PerSessionState {
  return {
    messages: [],
    historyBuffer: [],
    recentBuffer: [],
    historyLoadState: 'loaded',
    allMessagesLoaded: true,
    chatState: 'streaming',
    connectionState: 'connected',
    streamingText: '',
    streamingToolInput: '',
    activeToolUseId: null,
    activeToolName: null,
    activeThinkingId: null,
    pendingPermission: null,
    pendingComputerUsePermission: null,
    pendingSteers: [],
    tokenUsage: { input_tokens: 0, output_tokens: 0 },
    elapsedSeconds: 0,
    statusVerb: '',
    turnStartedAt: null,
    lastModelActivityAt: null,
    lastConnectionActivityAt: null,
    slashCommands: [],
    agentTaskNotifications: {},
    elapsedTimer: null,
    composerPrefill: null,
    ...overrides,
  }
}

describe('PendingSteerBar', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    useChatStore.setState({ sessions: {} })
  })

  it('moves a saved steer back into the composer for editing', () => {
    useChatStore.setState({
      sessions: {
        'edit-session': makeChatSession({
          pendingSteers: [
            {
              id: 'steer-1',
              content: 'Please also check the migration',
              createdAt: 1,
              status: 'draft',
            },
          ],
        }),
      },
    })

    render(<PendingSteerBar sessionId="edit-session" />)

    expect(screen.getByText('Please also check the migration')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit saved input' }))

    expect(useChatStore.getState().sessions['edit-session']?.pendingSteers).toEqual([])
    expect(useChatStore.getState().sessions['edit-session']?.composerPrefill).toMatchObject({
      text: 'Please also check the migration',
    })
  })

  it('shows multiple saved steers as separate one-line rows', () => {
    useChatStore.setState({
      sessions: {
        'multi-session': makeChatSession({
          pendingSteers: [
            {
              id: 'steer-1',
              content: 'First follow-up with a specific constraint',
              createdAt: 1,
              status: 'draft',
            },
            {
              id: 'steer-2',
              content: 'Second follow-up should stay editable by itself',
              createdAt: 2,
              status: 'draft',
            },
          ],
        }),
      },
    })

    render(<PendingSteerBar sessionId="multi-session" />)

    expect(screen.getByText('First follow-up with a specific constraint')).toBeInTheDocument()
    expect(screen.getByText('Second follow-up should stay editable by itself')).toBeInTheDocument()
    expect(screen.queryByTitle(/AI is working/)).not.toBeInTheDocument()
    expect(screen.queryByText('Send after')).not.toBeInTheDocument()
    expect(screen.queryByText(/\+1/)).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Join task' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Edit saved input' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Cancel queued input' })).toHaveLength(2)

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit saved input' })[1]!)

    expect(useChatStore.getState().sessions['multi-session']?.pendingSteers).toMatchObject([
      {
        id: 'steer-1',
        content: 'First follow-up with a specific constraint',
      },
    ])
    expect(useChatStore.getState().sessions['multi-session']?.composerPrefill).toMatchObject({
      text: 'Second follow-up should stay editable by itself',
    })
  })
})
