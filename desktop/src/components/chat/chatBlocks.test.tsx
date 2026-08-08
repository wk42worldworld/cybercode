import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCallBlock } from './ToolCallBlock'
import { ToolCallGroup } from './ToolCallGroup'
import { PermissionDialog } from './PermissionDialog'
import { useChatStore } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'

describe('chat blocks', () => {
  beforeEach(() => {
    useTabStore.setState({ activeTabId: 'active-tab', tabs: [{ sessionId: 'active-tab', title: 'Test', type: 'session' as const, status: 'idle' }] })
    useChatStore.setState({ sessions: {} })
    useSettingsStore.setState({ locale: 'en' })
  })

  it('keeps thinking collapsed by default', () => {
    const { container } = render(<ThinkingBlock content="this is a long internal reasoning trace" isActive />)

    expect(screen.getByText(/思考中|Thinking/)).toBeTruthy()
    expect(container.textContent).toContain('this is a long internal reasoning trace')
    expect(container.querySelector('.thinking-cursor')).toBeNull()
  })

  it('does not animate inactive historical thinking blocks', () => {
    const { container } = render(<ThinkingBlock content="old reasoning" isActive={false} />)

    expect(container.querySelector('.thinking-inline-cursor')).toBeNull()
  })

  it('shows tool previews only after expanding the tool block', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Read"
        input={{ file_path: '/tmp/example.ts', limit: 20 }}
        result={{ content: 'const answer = 42\nconsole.log(answer)', isError: false }}
      />,
    )

    expect(container.textContent).toContain('Read')
    expect(container.textContent).not.toContain('const answer = 42')

    fireEvent.click(screen.getByRole('button'))

    expect(container.textContent).toMatch(/工具输入|Tool Input/)
    expect(container.textContent).not.toContain('const answer = 42')
  })

  it('does not surface bash stdout in the transcript preview', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Bash"
        input={{ command: 'ls -la', description: 'List files' }}
        result={{ content: 'file-a\nfile-b\nfile-c', isError: false }}
      />,
    )

    expect(container.textContent).toContain('Bash')
    expect(container.textContent).not.toContain('file-a')

    fireEvent.click(screen.getByRole('button'))

    expect(container.textContent).toContain('ls -la')
    expect(container.textContent).not.toContain('file-a')
  })

  it('shows a collapsed error summary for failed bash commands', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Bash"
        input={{ command: 'git show 5016bc0 --no-stat', description: 'Show full diff of latest commit' }}
        result={{ content: 'fatal: unrecognized argument: --no-stat\nExit code 128', isError: true }}
      />,
    )

    expect(container.textContent).toContain('Bash')
    expect(container.textContent).toContain('fatal: unrecognized argument: --no-stat')
  })

  it('adds a running text sweep effect while a tool is executing', () => {
    const { container, rerender } = render(
      <ToolCallBlock
        toolName="Bash"
        input={{ command: 'bun test', description: 'Run tests' }}
        result={null}
      />,
    )

    expect(container.querySelector('.tool-running-sweep')).toBeTruthy()
    expect(container.querySelector('.tool-running-text')).toBeTruthy()

    rerender(
      <ToolCallBlock
        toolName="Bash"
        input={{ command: 'bun test', description: 'Run tests' }}
        result={{ content: 'ok', isError: false }}
      />,
    )

    expect(container.querySelector('.tool-running-sweep')).toBeNull()
    expect(container.querySelector('.tool-running-text')).toBeNull()
  })

  it('renders native CodeGraph calls as first-class tool blocks', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="CodeGraph"
        input={{ action: 'impact', query: 'ThemeSettings' }}
        result={{ content: 'No dependents', isError: false }}
      />,
    )

    expect(container.textContent).toContain('CodeGraph')
    expect(container.textContent).toContain('impact · ThemeSettings')
    expect(container.querySelector('.codicon-git-branch')).toBeTruthy()
  })

  it('marks a resultless historical tool as interrupted instead of running', () => {
    const webFetch = {
      id: 'fetch-call',
      type: 'tool_use' as const,
      toolName: 'WebFetch',
      toolUseId: 'fetch-tool',
      input: { url: 'https://github.com/trending' },
      timestamp: Date.now(),
    }

    const { container } = render(
      <ToolCallGroup
        toolCalls={[webFetch]}
        resultMap={new Map()}
        childToolCallsByParent={new Map()}
        agentTaskNotifications={{}}
        isStreaming={false}
      />,
    )

    expect(container.querySelector('[data-running="true"]')).toBeNull()
    expect(container.querySelector('[data-interrupted="true"]')).toBeTruthy()
    expect(container.querySelector('.tool-running-text')).toBeNull()
  })

  it('stops animating an Agent launch receipt after its assistant turn ends', () => {
    const agent = {
      id: 'agent-call',
      type: 'tool_use' as const,
      toolName: 'Agent',
      toolUseId: 'agent-tool',
      input: { description: 'Analyze MessageList.tsx for rendering bugs' },
      timestamp: Date.now(),
    }
    const launchResult = {
      id: 'agent-launch-result',
      type: 'tool_result' as const,
      toolUseId: 'agent-tool',
      content: [
        {
          type: 'text',
          text: [
            'Spawned successfully.',
            'agent_id: agent-1-messagelist@chat-msg-analysis',
            'The agent is now running and will receive instructions via mailbox.',
          ].join('\n'),
        },
      ],
      isError: false,
      timestamp: Date.now(),
    }

    const { container, rerender } = render(
      <ToolCallGroup
        toolCalls={[agent]}
        resultMap={new Map([['agent-tool', launchResult]])}
        childToolCallsByParent={new Map()}
        agentTaskNotifications={{}}
        isStreaming={false}
        isTurnActive={false}
      />,
    )

    expect(container.querySelector('[data-tool-activity-container]')?.getAttribute('data-running')).toBeNull()
    expect(container.querySelector('.tool-running-sweep')).toBeNull()
    expect(container.querySelector('[data-tool-activity-container]')?.getAttribute('data-layout')).toBe('collapsed')

    fireEvent.click(screen.getByRole('button'))
    expect(container.querySelectorAll('[data-running="true"]')).toHaveLength(0)
    expect(container.querySelector('.tool-running-sweep')).toBeNull()
    expect(container.textContent).toContain('Stopped')

    rerender(
      <ToolCallGroup
        toolCalls={[agent]}
        resultMap={new Map([['agent-tool', launchResult]])}
        childToolCallsByParent={new Map()}
        agentTaskNotifications={{}}
        isStreaming={false}
        isTurnActive
      />,
    )

    expect(container.querySelector('[data-tool-activity-container]')?.getAttribute('data-running')).toBe('true')
    expect(container.querySelectorAll('.tool-running-sweep').length).toBeGreaterThanOrEqual(2)
    expect(container.textContent).toContain('Running')
  })

  it('keeps parent tool calls in running text sweep while a child tool is executing', () => {
    const parent = {
      id: 'parent',
      type: 'tool_use' as const,
      toolName: 'Read',
      toolUseId: 'parent-tool',
      input: { file_path: '/tmp/parent.md' },
      timestamp: Date.now(),
    }
    const child = {
      id: 'child',
      type: 'tool_use' as const,
      toolName: 'Bash',
      toolUseId: 'child-tool',
      parentToolUseId: 'parent-tool',
      input: { command: 'bun test' },
      timestamp: Date.now(),
    }

    const { container } = render(
      <ToolCallGroup
        toolCalls={[parent]}
        resultMap={new Map([
          ['parent-tool', {
            id: 'parent-result',
            type: 'tool_result' as const,
            toolUseId: 'parent-tool',
            content: 'Agent started',
            isError: false,
            timestamp: Date.now(),
          }],
        ])}
        childToolCallsByParent={new Map([['parent-tool', [child]]])}
        agentTaskNotifications={{}}
      />,
    )

    expect(container.querySelectorAll('[data-running="true"]').length).toBeGreaterThanOrEqual(2)
    expect(container.querySelectorAll('.tool-running-text').length).toBeGreaterThanOrEqual(2)
  })

  it('adds running text sweep to the live tool group Run row', () => {
    const bash = {
      id: 'bash-call',
      type: 'tool_use' as const,
      toolName: 'Bash',
      toolUseId: 'bash-tool',
      input: { command: 'cd /tmp/whisper_job && whisper-cli meeting.wav' },
      timestamp: Date.now(),
    }

    const { container } = render(
      <ToolCallGroup
        toolCalls={[bash]}
        resultMap={new Map()}
        childToolCallsByParent={new Map()}
        agentTaskNotifications={{}}
        isStreaming
      />,
    )

    expect(container.textContent).toContain('Bash')
    expect(container.textContent).toContain('cd /tmp/whisper_job')
    expect(container.querySelector('[data-tool-activity-summary]')?.textContent).toBe(
      'Used 1 tool · Ran 1 command',
    )
    expect(container.querySelector('[data-running="true"]')).toBeTruthy()
    expect(container.querySelectorAll('.tool-running-text').length).toBeGreaterThanOrEqual(1)
    const activityDot = container.querySelector('[data-tool-activity-status-dot]')
    expect(activityDot?.className).toContain('h-2')
    expect(activityDot?.className).toContain('w-2')
  })

  it('collapses completed activity into one counted summary and expands details on demand', () => {
    const toolCalls = [
      {
        id: 'read-a',
        type: 'tool_use' as const,
        toolName: 'Read',
        toolUseId: 'read-a-tool',
        input: { file_path: '/tmp/example.ts' },
        timestamp: Date.now(),
      },
      {
        id: 'read-a-again',
        type: 'tool_use' as const,
        toolName: 'Read',
        toolUseId: 'read-a-again-tool',
        input: { file_path: '/tmp/example.ts' },
        timestamp: Date.now(),
      },
      {
        id: 'bash',
        type: 'tool_use' as const,
        toolName: 'Bash',
        toolUseId: 'bash-tool',
        input: { command: 'bun test' },
        timestamp: Date.now(),
      },
      {
        id: 'edit-a',
        type: 'tool_use' as const,
        toolName: 'Edit',
        toolUseId: 'edit-a-tool',
        input: { file_path: '/tmp/example.ts', old_string: 'a', new_string: 'b' },
        timestamp: Date.now(),
      },
      {
        id: 'write-a',
        type: 'tool_use' as const,
        toolName: 'Write',
        toolUseId: 'write-a-tool',
        input: { file_path: '/tmp/example.ts', content: 'b' },
        timestamp: Date.now(),
      },
    ]
    const resultMap = new Map(toolCalls.map((toolCall) => [
      toolCall.toolUseId,
      {
        id: `${toolCall.id}-result`,
        type: 'tool_result' as const,
        toolUseId: toolCall.toolUseId,
        content: 'ok',
        isError: false,
        timestamp: Date.now(),
      },
    ]))

    const { container } = render(
      <ToolCallGroup
        toolCalls={toolCalls}
        resultMap={resultMap}
        childToolCallsByParent={new Map()}
        agentTaskNotifications={{}}
        isStreaming={false}
      />,
    )

    expect(container.querySelector('[data-tool-activity-summary]')?.textContent).toBe(
      'Used 5 tools · Read 1 file · Ran 1 command · Modified 1 file',
    )
    expect(container.querySelector('[data-tool-activity-details]')).toBeNull()
    expect(container.textContent).not.toContain('bun test')
    expect(container.querySelector('[class*="border-l-"]')).toBeNull()
    const activityContainer = container.querySelector('[data-tool-activity-container]')
    expect(activityContainer?.parentElement?.className).toContain('justify-center')
    expect(activityContainer?.getAttribute('data-layout')).toBe('collapsed')
    expect(activityContainer?.className).toContain('w-full')
    expect(activityContainer?.className).toContain('rounded-[24px]')
    expect(activityContainer?.className).toContain('border-[var(--color-border)]')
    expect(activityContainer?.className).toContain('bg-[var(--color-surface-container-lowest)]')
    expect(activityContainer?.className).not.toContain('shadow-')
    const activityButton = container.querySelector('[data-tool-activity-container] > button') as HTMLButtonElement
    expect(activityButton.className).toContain('justify-center')
    expect(activityButton.className).toContain('text-center')
    expect(activityButton.className).not.toContain('border-b')
    expect(activityButton.className).toContain('h-[44px]')
    expect(activityButton.className).toContain('px-[16px]')
    expect(activityButton.firstElementChild?.hasAttribute('data-tool-activity-status')).toBe(true)
    expect(activityButton.lastElementChild?.hasAttribute('data-tool-activity-disclosure')).toBe(true)
    const collapsedWidthClasses = activityContainer?.className

    fireEvent.click(activityButton)

    expect(activityContainer?.getAttribute('data-layout')).toBe('expanded')
    expect(activityContainer?.className).toBe(collapsedWidthClasses)
    const activityDetails = container.querySelector('[data-tool-activity-details]')
    expect(activityDetails?.className).toContain('border-t')
    expect(activityDetails?.className).toContain('max-h-[284px]')
    expect(activityDetails?.className).toContain('overflow-y-auto')
    expect(activityDetails?.className).toContain('scrollbar-no-track')
    expect(activityButton.className).toContain('text-center')
    expect(activityButton.className).not.toContain('border-b')
    expect(container.textContent).toContain('bun test')
  })

  it('keeps live activity expanded while counts update', () => {
    const read = {
      id: 'live-read',
      type: 'tool_use' as const,
      toolName: 'Read',
      toolUseId: 'live-read-tool',
      input: { file_path: '/tmp/live.ts' },
      timestamp: Date.now(),
    }
    const edit = {
      id: 'live-edit',
      type: 'tool_use' as const,
      toolName: 'Edit',
      toolUseId: 'live-edit-tool',
      input: { file_path: '/tmp/live.ts', old_string: 'a', new_string: 'b' },
      timestamp: Date.now(),
    }

    const { container, rerender } = render(
      <ToolCallGroup
        toolCalls={[read]}
        resultMap={new Map()}
        childToolCallsByParent={new Map()}
        agentTaskNotifications={{}}
        isStreaming
      />,
    )

    expect(container.querySelector('[data-tool-activity-summary]')?.textContent).toContain(
      'Used 1 tool · Read 1 file',
    )
    const activityContainer = container.querySelector('[data-tool-activity-container]')
    expect(activityContainer?.getAttribute('data-layout')).toBe('expanded')
    expect(activityContainer?.className).toContain('w-full')
    expect(container.querySelector('[data-tool-activity-details]')).toBeTruthy()

    rerender(
      <ToolCallGroup
        toolCalls={[read, edit]}
        resultMap={new Map()}
        childToolCallsByParent={new Map()}
        agentTaskNotifications={{}}
        isStreaming
      />,
    )

    expect(container.querySelector('[data-tool-activity-summary]')?.textContent).toContain(
      'Used 2 tools · Read 1 file · Modified 1 file',
    )
    expect(container.querySelector('[data-tool-activity-details]')).toBeTruthy()
  })

  it('stays expanded between tool waves until the assistant turn finishes', () => {
    const read = {
      id: 'completed-read',
      type: 'tool_use' as const,
      toolName: 'Read',
      toolUseId: 'completed-read-tool',
      input: { file_path: '/tmp/completed.ts' },
      timestamp: Date.now(),
    }
    const resultMap = new Map([
      ['completed-read-tool', {
        id: 'completed-read-result',
        type: 'tool_result' as const,
        toolUseId: 'completed-read-tool',
        content: 'ok',
        isError: false,
        timestamp: Date.now(),
      }],
    ])

    const { container, rerender } = render(
      <ToolCallGroup
        toolCalls={[read]}
        resultMap={resultMap}
        childToolCallsByParent={new Map()}
        agentTaskNotifications={{}}
        isStreaming={false}
        isTurnActive
      />,
    )

    const activityButton = container.querySelector('[data-tool-activity-container] > button') as HTMLButtonElement
    expect(activityButton.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('[data-tool-activity-details]')).toBeTruthy()
    expect(container.querySelector('[data-running="true"]')).toBeNull()

    fireEvent.click(activityButton)
    expect(activityButton.getAttribute('aria-expanded')).toBe('true')

    rerender(
      <ToolCallGroup
        toolCalls={[read]}
        resultMap={resultMap}
        childToolCallsByParent={new Map()}
        agentTaskNotifications={{}}
        isStreaming={false}
        isTurnActive={false}
      />,
    )

    expect(activityButton.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('[data-tool-activity-details]')).toBeNull()
  })

  it('marks an orphaned tool group as stopped after the session becomes idle', () => {
    const webFetch = {
      id: 'fetch-log-call',
      type: 'tool_use' as const,
      toolName: 'WebFetch',
      toolUseId: 'fetch-log-tool',
      input: { url: 'https://github.com/trending' },
      timestamp: Date.now(),
    }

    const { container } = render(
      <ToolCallGroup
        toolCalls={[webFetch]}
        resultMap={new Map()}
        childToolCallsByParent={new Map()}
        agentTaskNotifications={{}}
        isStreaming={false}
      />,
    )

    expect(container.querySelector('[data-running="true"]')).toBeNull()
    expect(container.querySelector('[title]') || container.querySelector('[data-running]')).toBeTruthy()
    expect(container.querySelector('.tool-running-text')).toBeNull()
  })

  it('keeps tool group running while a nested child tool is executing', () => {
    const parent = {
      id: 'parent-log',
      type: 'tool_use' as const,
      toolName: 'Read',
      toolUseId: 'parent-log-tool',
      input: { file_path: '/tmp/transcribe.md' },
      timestamp: Date.now(),
    }
    const child = {
      id: 'child-log',
      type: 'tool_use' as const,
      toolName: 'Bash',
      toolUseId: 'child-log-tool',
      parentToolUseId: 'parent-log-tool',
      input: { command: 'whisper-cli meeting.wav' },
      timestamp: Date.now(),
    }

    const { container } = render(
      <ToolCallGroup
        toolCalls={[parent]}
        resultMap={new Map([
          ['parent-log-tool', {
            id: 'parent-log-result',
            type: 'tool_result' as const,
            toolUseId: 'parent-log-tool',
            content: 'Agent started',
            isError: false,
            timestamp: Date.now(),
          }],
        ])}
        childToolCallsByParent={new Map([['parent-log-tool', [child]]])}
        agentTaskNotifications={{}}
        isStreaming
      />,
    )

    expect(container.textContent).toContain('Read')
    expect(container.querySelectorAll('[data-running="true"]').length).toBeGreaterThanOrEqual(2)
  })

  it('expands tool errors so full Computer Use gate messages are readable', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="mcp__computer-use__left_click"
        input={{ coordinate: [120, 220] }}
        result={{
          content: '"CyberCode" is not in the allowed applications and is currently in front. Take a new screenshot — it may have appeared since your last one.',
          isError: true,
        }}
      />,
    )

    expect(container.textContent).toContain('mcp__computer-use__left_click')
    expect(container.textContent).not.toContain('Take a new screenshot')

    fireEvent.click(screen.getByRole('button'))

    expect(container.textContent).toContain('Take a new screenshot')
    expect(container.textContent).toContain('allowed applications')
  })

  it('shows a diff preview for edit permission requests', () => {
    useChatStore.setState({
      sessions: {
        'active-tab': {
          messages: [],
          historyBuffer: [],
          recentBuffer: [],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: {
            requestId: 'perm-1',
            toolName: 'Edit',
            input: {
              file_path: '/tmp/example.ts',
              old_string: 'const count = 1',
              new_string: 'const count = 2',
            },
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

    const { container } = render(
      <PermissionDialog
        requestId="perm-1"
        toolName="Edit"
        input={{
          file_path: '/tmp/example.ts',
          old_string: 'const count = 1',
          new_string: 'const count = 2',
        }}
      />,
    )

    expect(container.textContent).toContain('/tmp/example.ts')
    expect(container.textContent).toMatch(/允许|Allow/)
    // react-diff-viewer-continued uses styled-components tables that don't
    // fully render in jsdom, so we verify the DiffViewer wrapper is mounted
    expect(container.querySelector('[class*="rounded-[var(--radius-lg)]"]')).toBeTruthy()
  })

  it('renders ExitPlanMode as a compact plan confirmation instead of a tool authorization', () => {
    useChatStore.setState({
      sessions: {
        'active-tab': {
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
            requestId: 'plan-1',
            toolName: 'ExitPlanMode',
            input: {
              plan: '# UI redesign\n\nTighten the layout and verify it.',
              planFilePath: '/tmp/plan.md',
            },
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

    const { container } = render(
      <PermissionDialog
        requestId="plan-1"
        toolName="ExitPlanMode"
        input={{
          plan: '# UI redesign\n\nTighten the layout and verify it.',
          planFilePath: '/tmp/plan.md',
        }}
      />,
    )

    const card = container.querySelector<HTMLElement>('[data-permission-kind="plan"]')
    expect(card?.getAttribute('data-permission-state')).toBe('pending')
    expect(card?.className).toContain('max-w-[640px]')
    expect(container.textContent).toMatch(/执行方案确认|Plan confirmation/)
    expect(container.textContent).toMatch(/开始执行|Start implementing/)
    expect(container.textContent).toMatch(/继续规划|Keep planning/)
    expect(container.textContent).not.toMatch(/本次会话允许|Allow for session/)
    expect(container.textContent).not.toMatch(/显示完整输入|Show full input/)
    expect(container.textContent).not.toContain('ExitPlanMode')
  })

  it('collapses a handled ExitPlanMode request without retaining its raw plan', () => {
    const { container } = render(
      <PermissionDialog
        requestId="handled-plan"
        toolName="ExitPlanMode"
        input={{ plan: 'A very long implementation plan that should not remain expanded.' }}
      />,
    )

    const row = container.querySelector<HTMLElement>('[data-permission-kind="plan"]')
    expect(row?.getAttribute('data-permission-state')).toBe('responded')
    expect(row?.className).toContain('w-fit')
    expect(container.textContent).toMatch(/执行方案确认|Plan confirmation/)
    expect(container.textContent).toMatch(/已处理|Handled/)
    expect(container.textContent).not.toContain('A very long implementation plan')
    expect(container.textContent).not.toMatch(/显示完整输入|Show full input/)
  })
})
