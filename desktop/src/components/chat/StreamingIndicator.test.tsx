import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { translate } from '../../i18n'
import { SPINNER_VERBS } from '../../config/spinnerVerbs'
import { getSpinnerVerbTranslation } from '../../config/spinnerVerbTranslations'
import { useChatStore, type PerSessionState } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { StreamingIndicator, resolveStreamingVerb } from './StreamingIndicator'

function makeSession(overrides: Partial<PerSessionState> = {}): PerSessionState {
  return {
    messages: [],
    historyBuffer: [],
    recentBuffer: [],
    allMessagesLoaded: true,
    historyLoadState: 'loaded',
    chatState: 'thinking',
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
    elapsedSeconds: 65,
    statusVerb: 'Accomplishing',
    slashCommands: [],
    agentTaskNotifications: {},
    elapsedTimer: null,
    ...overrides,
  }
}

describe('StreamingIndicator', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'zh' })
    useChatStore.setState({ sessions: { 'session-1': makeSession() } })
  })

  it('localizes random English activity verbs outside English mode', () => {
    const localized = resolveStreamingVerb(
      'Accomplishing',
      'thinking',
      'zh',
      (key) => translate('zh', key),
    )
    expect(localized).toBe('正在大功告成')

    render(<StreamingIndicator sessionId="session-1" />)
    expect(screen.getByTestId('streaming-indicator')).toHaveTextContent(localized)
    expect(screen.getByTestId('streaming-indicator')).toHaveTextContent('1分 5秒')
    const verb = screen.getByTestId('streaming-verb')
    const elapsed = screen.getByTestId('streaming-elapsed')
    expect(verb.className).toContain('h-[18px]')
    expect(verb.className).toContain('text-[12px]')
    expect(verb.className).toContain('leading-[18px]')
    expect(elapsed.className).toContain('h-[18px]')
    expect(elapsed.className).toContain('text-[12px]')
    expect(elapsed.className).toContain('leading-[18px]')
    expect(elapsed.className).toContain('items-center')
    expect(elapsed.className).not.toContain('font-mono')
  })

  it('provides a distinct Chinese translation for every built-in playful verb', () => {
    const missing = SPINNER_VERBS.filter((verb) => !getSpinnerVerbTranslation(verb, 'zh'))
    expect(missing).toEqual([])
    expect(getSpinnerVerbTranslation('Baking', 'zh')).toBe('正在烘焙灵感')
    expect(getSpinnerVerbTranslation('Moonwalking', 'zh')).toBe('正在月球漫步式思考')
    expect(getSpinnerVerbTranslation('Razzle-dazzling', 'zh')).toBe('正在大显身手')
  })

  it('preserves the original playful verb in English mode', () => {
    expect(resolveStreamingVerb(
      'Accomplishing',
      'thinking',
      'en',
      (key) => translate('en', key),
    )).toBe('Accomplishing')
  })

  it('translates explicit server lifecycle states', () => {
    expect(resolveStreamingVerb(
      'Switching provider and model...',
      'thinking',
      'zh',
      (key) => translate('zh', key),
    )).toBe('正在切换模型和厂商...')
  })

  it('does not render after the turn becomes idle', () => {
    useChatStore.setState({ sessions: { 'session-1': makeSession({ chatState: 'idle' }) } })
    render(<StreamingIndicator sessionId="session-1" />)
    expect(screen.queryByTestId('streaming-indicator')).not.toBeInTheDocument()
  })
})
