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
})
