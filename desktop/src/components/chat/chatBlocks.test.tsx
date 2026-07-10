import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCallBlock } from './ToolCallBlock'
import { ToolCallGroup } from './ToolCallGroup'
import { MessageExecutionLog } from './MessageExecutionLog'
import { PermissionDialog } from './PermissionDialog'
import { useChatStore } from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'

describe('chat blocks', () => {
  beforeEach(() => {
    useTabStore.setState({ activeTabId: 'active-tab', tabs: [{ sessionId: 'active-tab', title: 'Test', type: 'session' as const, status: 'idle' }] })
    useChatStore.setState({ sessions: {} })
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

  it('adds running text sweep to the collapsed execution log Run row', () => {
    const bash = {
      id: 'bash-call',
      type: 'tool_use' as const,
      toolName: 'Bash',
      toolUseId: 'bash-tool',
      input: { command: 'cd /tmp/whisper_job && whisper-cli meeting.wav' },
      timestamp: Date.now(),
    }

    const { container } = render(
      <MessageExecutionLog
        toolCalls={[bash]}
        resultMap={new Map()}
      />,
    )

    expect(container.textContent).toContain('Run')
    expect(container.textContent).toContain('cd /tmp/whisper_job')
    expect(container.querySelector('[data-running="true"]')).toBeTruthy()
    expect(container.querySelectorAll('.tool-running-text').length).toBeGreaterThanOrEqual(2)
  })

  it('stops an orphaned execution-log row after the session becomes idle', () => {
    const webFetch = {
      id: 'fetch-log-call',
      type: 'tool_use' as const,
      toolName: 'WebFetch',
      toolUseId: 'fetch-log-tool',
      input: { url: 'https://github.com/trending' },
      timestamp: Date.now(),
    }

    const { container } = render(
      <MessageExecutionLog
        toolCalls={[webFetch]}
        resultMap={new Map()}
        isActive={false}
      />,
    )

    expect(container.querySelector('[data-running="true"]')).toBeNull()
    expect(container.querySelector('[data-interrupted="true"]')).toBeTruthy()
    expect(container.querySelector('.tool-running-text')).toBeNull()
  })

  it('keeps collapsed execution log parent rows running while a child tool is executing', () => {
    const parent = {
      id: 'parent-log',
      type: 'tool_use' as const,
      toolName: 'Agent',
      toolUseId: 'parent-log-tool',
      input: { description: 'Transcribe meeting' },
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
      <MessageExecutionLog
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
      />,
    )

    expect(container.textContent).toContain('Agent')
    expect(container.textContent).toContain('Transcribe meeting')
    expect(container.querySelector('[data-running="true"]')).toBeTruthy()
    expect(container.querySelectorAll('.tool-running-text').length).toBeGreaterThanOrEqual(2)
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
})
