import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  agentMigrationApi,
  type AgentMigrationScan,
  type DetectedExternalAgent,
  type ExternalAgentId,
} from '../api/agentMigration'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'
import { AgentMigration } from './AgentMigration'

vi.mock('../api/agentMigration', () => ({
  agentMigrationApi: {
    scan: vi.fn(),
    preview: vi.fn(),
    migrate: vi.fn(),
  },
}))

describe('AgentMigration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({ locale: 'zh' })
    useUIStore.setState({ toasts: [] })
    vi.mocked(agentMigrationApi.scan).mockImplementation(async targetAgentId =>
      scanFixture(targetAgentId))
    vi.mocked(agentMigrationApi.migrate).mockResolvedValue({
      imported: 1,
      skipped: 0,
      failed: 0,
      registeredProjects: [],
      items: [{ id: 'openclaw-memory', status: 'imported' }],
    })
  })

  it('shows all supported agents and their detection state', async () => {
    const { container } = render(<AgentMigration />)

    expect((await screen.findAllByText('OpenClaw')).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('CyberCode').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('WorkBuddy').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Claude Code').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Codex').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/Cursor/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Trae').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/Hermes Agent/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/DeepSeek TUI \/ CodeWhale/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Kimi Code').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Pi').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('未检测到')).toHaveLength(7)
    expect(screen.getByText('0 个文件 · 1 个项目')).toBeInTheDocument()
    expect(await screen.findByText('原生格式')).toHaveAttribute(
      'title',
      'CyberCode searchable project memory',
    )
    expect(container.querySelector('[data-agent-logo="cybercode"]')).toHaveAttribute('src', '/app-icon.png')
    expect(container.querySelector('[data-agent-logo="openclaw"]')).toHaveAttribute('src', '/agent-icons/openclaw.png')
    expect(container.querySelector('[data-agent-logo="claude-code"]')).toHaveAttribute('src', '/agent-icons/claude-code.png')
    expect(container.querySelector('[data-agent-logo="codex"]')).toHaveAttribute('src', '/agent-icons/codex.png')
    expect(container.querySelector('[data-agent-logo="cursor"]')).toHaveAttribute('src', '/agent-icons/cursor.png')
    expect(container.querySelector('[data-agent-logo="trae"]')).toHaveAttribute('src', '/agent-icons/trae.svg')
    expect(container.querySelector('[data-agent-logo="hermes-agent"]')).toHaveAttribute('src', '/agent-icons/hermes-agent.png')
    expect(container.querySelector('[data-agent-logo="deepseek-tui"]')).toHaveAttribute('src', '/agent-icons/codewhale.svg')
    expect(container.querySelector('[data-agent-logo="workbuddy"]')).toHaveAttribute('src', '/agent-icons/workbuddy.svg')
    expect(container.querySelector('[data-agent-logo="kimi-code"]')).toHaveAttribute('src', '/agent-icons/kimi-code.png')
    expect(container.querySelector('[data-agent-logo="pi"]')).toHaveAttribute('src', '/agent-icons/pi.svg')
    expect(container.querySelector('svg[data-agent-logo]')).not.toBeInTheDocument()
    const layout = container.querySelector('.agent-migration-layout')
    expect(layout).toHaveClass('grid-cols-1', 'lg:grid-cols-[224px_minmax(0,1fr)]')
    expect(layout?.querySelector('aside')).toHaveClass('hidden', 'lg:block')
    expect(container.querySelector('.agent-migration-list')).toHaveClass('min-h-[220px]', 'lg:min-h-[280px]')
  })

  it('opens a branded destination picker with every agent logo and state', async () => {
    render(<AgentMigration />)

    const trigger = await screen.findByTestId('target-agent-picker')
    expect(trigger).toHaveAttribute('data-target-agent', 'cybercode')
    expect(trigger.querySelector('[data-agent-logo="cybercode"]')).toBeInTheDocument()
    fireEvent.click(trigger)

    const listbox = await screen.findByRole('listbox', { name: '被迁移方' })
    const expectedAgents = [
      ['CyberCode', 'cybercode'],
      ['OpenClaw', 'openclaw'],
      ['WorkBuddy', 'workbuddy'],
      ['Claude Code', 'claude-code'],
      ['Codex', 'codex'],
      ['Cursor', 'cursor'],
      ['Trae', 'trae'],
      ['Hermes Agent', 'hermes-agent'],
      ['DeepSeek TUI / CodeWhale', 'deepseek-tui'],
      ['Kimi Code', 'kimi-code'],
      ['Pi', 'pi'],
    ] as const
    const options = within(listbox).getAllByRole('option')
    const optionsByAgentId = new Map(options.map(option => {
      const logo = option.querySelector('[data-agent-logo]')
      return [logo?.getAttribute('data-agent-logo'), option]
    }))

    expect(options).toHaveLength(expectedAgents.length)
    for (const [name, id] of expectedAgents) {
      const option = optionsByAgentId.get(id)
      expect(option).toBeDefined()
      expect(option).toHaveTextContent(name)
      expect(option?.querySelector(`[data-agent-logo="${id}"]`)).toBeInTheDocument()
    }
    expect(optionsByAgentId.get('cybercode')).toHaveAttribute('aria-selected', 'true')
    expect(optionsByAgentId.get('openclaw')).toBeDisabled()
    expect(optionsByAgentId.get('cursor')).toBeDisabled()
    expect(within(listbox).getByText('默认')).toBeInTheDocument()
  })

  it('switches the migration source from a branded source picker', async () => {
    render(<AgentMigration />)

    const trigger = await screen.findByTestId('source-agent-picker')
    expect(trigger).toHaveAttribute('data-source-agent', 'openclaw')
    expect(trigger.querySelector('[data-agent-logo="openclaw"]')).toBeInTheDocument()
    fireEvent.click(trigger)

    const listbox = await screen.findByRole('listbox', { name: '迁移方' })
    expect(within(listbox).getByRole('option', { name: /OpenClaw/ })).toHaveAttribute('aria-selected', 'true')
    expect(within(listbox).getByRole('option', { name: /CyberCode/ })).toBeDisabled()
    expect(within(listbox).getByRole('option', { name: /WorkBuddy/ })).toBeDisabled()
    expect(within(listbox).queryByText('默认')).not.toBeInTheDocument()

    fireEvent.click(within(listbox).getByRole('option', { name: /Claude Code/ }))

    await waitFor(() => expect(trigger).toHaveAttribute('data-source-agent', 'claude-code'))
    expect(screen.getByRole('heading', { name: 'Claude Code' })).toBeInTheDocument()
    expect(screen.getByTestId('target-agent-picker')).toHaveAttribute('data-target-agent', 'cybercode')
  })

  it('aligns source and destination with the same route field geometry', async () => {
    render(<AgentMigration />)

    const source = await screen.findByTestId('source-agent-picker')
    const target = screen.getByTestId('target-agent-picker')
    expect(source).toHaveClass('h-[40px]', 'mt-[2px]', 'border')
    expect(target).toHaveClass('h-[40px]', 'mt-[2px]', 'border')
    expect(screen.getByRole('button', { name: '交换迁移方向' })).toHaveClass('h-[40px]', 'w-[40px]')
  })

  it('migrates only recommended global items from the one-click action', async () => {
    render(<AgentMigration />)

    fireEvent.click(await screen.findByRole('button', { name: '迁移推荐项到 CyberCode（1）' }))

    await waitFor(() => {
      expect(agentMigrationApi.migrate).toHaveBeenCalledWith({
        agentId: 'openclaw',
        targetAgentId: 'cybercode',
        allRecommended: true,
      })
    })
    await waitFor(() => expect(agentMigrationApi.scan).toHaveBeenCalledTimes(2))
    const toasts = useUIStore.getState().toasts
    expect(toasts[toasts.length - 1]?.type).toBe('success')
  })

  it('surfaces destination compatibility notes after migration', async () => {
    vi.mocked(agentMigrationApi.migrate).mockResolvedValue({
      imported: 1,
      skipped: 0,
      failed: 0,
      registeredProjects: [],
      items: [{
        id: 'openclaw-memory',
        status: 'imported',
        message: 'Target memory needs to be enabled.',
      }],
    })
    render(<AgentMigration />)

    fireEvent.click(await screen.findByRole('button', { name: '迁移这一项' }))

    await waitFor(() => {
      const toasts = useUIStore.getState().toasts
      const toast = toasts[toasts.length - 1]
      expect(toast?.type).toBe('warning')
      expect(toast?.message).toContain('Target memory needs to be enabled.')
    })
  })

  it('previews and individually migrates a detected memory file', async () => {
    const openClaw = scanFixture().agents.find(agent => agent.id === 'openclaw')!
    vi.mocked(agentMigrationApi.preview).mockResolvedValue({
      item: openClaw.items[0]!,
      content: '# Memory\nUse TypeScript.',
      truncated: false,
    })
    render(<AgentMigration />)

    fireEvent.click(await screen.findByRole('button', { name: '预览文件' }))
    expect(await screen.findByText(/Use TypeScript\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))

    fireEvent.click(screen.getByRole('button', { name: '迁移这一项' }))
    await waitFor(() => {
      expect(agentMigrationApi.migrate).toHaveBeenCalledWith({
        agentId: 'openclaw',
        targetAgentId: 'cybercode',
        itemIds: ['openclaw-memory'],
      })
    })
  })

  it('registers a recognized project from the projects filter', async () => {
    vi.mocked(agentMigrationApi.migrate).mockResolvedValue({
      imported: 0,
      skipped: 0,
      failed: 0,
      registeredProjects: ['/workspace/app'],
      items: [],
    })
    render(<AgentMigration />)

    fireEvent.click(await screen.findByRole('button', { name: 'Codex' }))
    fireEvent.click(screen.getByRole('button', { name: '项目' }))
    fireEvent.click(screen.getByRole('button', { name: '迁移并登记项目' }))

    await waitFor(() => {
      expect(agentMigrationApi.migrate).toHaveBeenCalledWith({
        agentId: 'codex',
        targetAgentId: 'cybercode',
        projectIds: ['codex-project'],
      })
    })
    await waitFor(() => {
      const toasts = useUIStore.getState().toasts
      expect(toasts[toasts.length - 1]?.message).toContain('已登记 1 个项目。')
    })
  })

  it('selects another detected destination and sends it with the migration request', async () => {
    render(<AgentMigration />)

    fireEvent.click(await screen.findByTestId('target-agent-picker'))
    fireEvent.click(await screen.findByRole('option', { name: /Claude Code/ }))

    await waitFor(() => expect(agentMigrationApi.scan).toHaveBeenCalledWith(
      'claude-code',
      expect.any(AbortSignal),
    ))
    expect(screen.getByTestId('target-agent-picker')).toHaveAttribute('data-target-agent', 'claude-code')
    fireEvent.click(await screen.findByRole('button', { name: '迁移推荐项到 Claude Code（1）' }))
    await waitFor(() => {
      expect(agentMigrationApi.migrate).toHaveBeenCalledWith({
        agentId: 'openclaw',
        targetAgentId: 'claude-code',
        allRecommended: true,
      })
    })
  })

  it('keeps the automatically selected source when only the destination changes', async () => {
    vi.mocked(agentMigrationApi.scan).mockImplementation(async targetAgentId => {
      const fixture = scanFixture(targetAgentId)
      const cybercode = fixture.agents.find(agent => agent.id === 'cybercode')!
      cybercode.items = [{
        ...fixture.agents.find(agent => agent.id === 'openclaw')!.items[0]!,
        id: 'cybercode-memory',
        agentId: 'cybercode',
        sourcePath: '/Users/test/.cyber/prompt-memory/USER.md',
      }]
      cybercode.counts.memories = 1
      return fixture
    })
    render(<AgentMigration />)

    expect(await screen.findByRole('heading', { name: 'OpenClaw' })).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('target-agent-picker'))
    fireEvent.click(await screen.findByRole('option', { name: /Claude Code/ }))

    await waitFor(() => expect(screen.getByTestId('target-agent-picker')).toHaveAttribute(
      'data-target-agent',
      'claude-code',
    ))
    expect(screen.getByRole('heading', { name: 'OpenClaw' })).toBeInTheDocument()
  })

  it('hides stale destination formats while rescanning a newly selected target', async () => {
    const pendingScan = new Promise<AgentMigrationScan>(() => {})
    vi.mocked(agentMigrationApi.scan)
      .mockResolvedValueOnce(scanFixture())
      .mockImplementationOnce(() => pendingScan)
    render(<AgentMigration />)

    expect(await screen.findByText('原生格式')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('target-agent-picker'))
    fireEvent.click(await screen.findByRole('option', { name: /Claude Code/ }))

    expect(await screen.findByText('正在检测本地 Agent 数据...')).toBeInTheDocument()
    expect(screen.queryByText('原生格式')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Codex' })).toBeDisabled()
  })

  it('cancels an in-flight scan and leaves a visible retry action', async () => {
    vi.mocked(agentMigrationApi.scan).mockImplementation((_targetAgentId, signal) =>
      new Promise<AgentMigrationScan>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      }))
    render(<AgentMigration />)

    const cancel = await screen.findByRole('button', { name: '取消扫描' })
    const signal = vi.mocked(agentMigrationApi.scan).mock.calls[0]?.[1]
    expect(signal?.aborted).toBe(false)
    fireEvent.click(cancel)

    expect(signal?.aborted).toBe(true)
    expect(await screen.findByText('没有检测到支持的 Agent。')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '重新检测' }).length).toBeGreaterThan(0)
  })

  it('shows and disables an incompatible destination type before migration', async () => {
    const fixture = scanFixture()
    const item = fixture.agents.find(agent => agent.id === 'openclaw')!.items[0]!
    item.selectable = false
    item.selectionIssue = 'destination-conflict'
    item.destinationState = 'conflict'
    vi.mocked(agentMigrationApi.scan).mockResolvedValue(fixture)

    render(<AgentMigration />)

    expect(await screen.findByText('目标类型冲突')).toBeInTheDocument()
    expect(screen.getByLabelText('选择 MEMORY.md')).toBeDisabled()
    expect(screen.getByRole('button', { name: '迁移这一项' })).toBeDisabled()
  })

  it('reverses the route so CyberCode can be the migration source', async () => {
    render(<AgentMigration />)

    fireEvent.click(await screen.findByRole('button', { name: '交换迁移方向' }))

    await waitFor(() => expect(screen.getByTestId('target-agent-picker')).toHaveAttribute('data-target-agent', 'openclaw'))
    expect(screen.getByRole('button', { name: 'CyberCode' })).toHaveClass('bg-[var(--color-surface-selected)]')
  })

  it('restores CyberCode as the default destination when another external source is selected', async () => {
    render(<AgentMigration />)

    fireEvent.click(await screen.findByTestId('target-agent-picker'))
    fireEvent.click(await screen.findByRole('option', { name: /Claude Code/ }))
    await waitFor(() => expect(screen.getByTestId('target-agent-picker')).toHaveAttribute('data-target-agent', 'claude-code'))

    fireEvent.click(screen.getByRole('button', { name: 'Codex' }))

    await waitFor(() => expect(screen.getByTestId('target-agent-picker')).toHaveAttribute('data-target-agent', 'cybercode'))
    expect(agentMigrationApi.scan).toHaveBeenCalledTimes(2)
    const scanCalls = vi.mocked(agentMigrationApi.scan).mock.calls
    expect(scanCalls.map(([targetAgentId]) => targetAgentId)).toEqual([
      'cybercode',
      'claude-code',
    ])
    expect(scanCalls.every(([, signal]) => signal instanceof AbortSignal)).toBe(true)
    expect(screen.getByRole('heading', { name: 'Codex' })).toBeInTheDocument()
  })

  it('supports keyboard navigation in the destination picker', async () => {
    render(<AgentMigration />)

    const trigger = await screen.findByTestId('target-agent-picker')
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const listbox = await screen.findByRole('listbox', { name: '被迁移方' })
    await waitFor(() => expect(within(listbox).getByRole('option', { name: /CyberCode/ })).toHaveFocus())

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    await waitFor(() => expect(within(listbox).getByRole('option', { name: /Claude Code/ })).toHaveFocus())
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' })

    await waitFor(() => expect(screen.getByTestId('target-agent-picker')).toHaveAttribute('data-target-agent', 'claude-code'))
    expect(screen.queryByRole('listbox', { name: '被迁移方' })).not.toBeInTheDocument()
  })

  it('initially selects a detected source that actually has migratable data', async () => {
    const fixture = scanFixture()
    const openClaw = fixture.agents.find(agent => agent.id === 'openclaw')!
    const claude = fixture.agents.find(agent => agent.id === 'claude-code')!
    const item = openClaw.items[0]!
    openClaw.items = []
    openClaw.counts.memories = 0
    claude.items = [{
      ...item,
      id: 'claude-memory',
      agentId: 'claude-code',
      name: 'CLAUDE.md',
    }]
    claude.counts.memories = 1
    vi.mocked(agentMigrationApi.scan).mockResolvedValue(fixture)

    render(<AgentMigration />)

    expect(await screen.findByRole('heading', { name: 'Claude Code' })).toBeInTheDocument()
  })

  it('rejects a stale scan response for the wrong destination', async () => {
    vi.mocked(agentMigrationApi.scan).mockResolvedValue(scanFixture('claude-code'))

    render(<AgentMigration />)

    expect(await screen.findByRole('alert')).toHaveTextContent('无法检测本地 Agent。')
    expect(screen.queryByRole('heading', { name: 'OpenClaw' })).not.toBeInTheDocument()
  })

  it('disables project migration when every project item exceeds the limit', async () => {
    vi.mocked(agentMigrationApi.scan).mockImplementation(async targetAgentId => {
      const fixture = scanFixture(targetAgentId)
      const template = fixture.agents.find(agent => agent.id === 'openclaw')!.items[0]!
      const codex = fixture.agents.find(agent => agent.id === 'codex')!
      codex.items = [{
        ...template,
        id: 'codex-oversized-memory',
        agentId: 'codex',
        scope: 'project',
        projectPath: '/workspace/app',
        selectable: false,
      }]
      codex.counts.memories = 1
      codex.projects[0]!.itemIds = ['codex-oversized-memory']
      return fixture
    })
    render(<AgentMigration />)

    fireEvent.click(await screen.findByRole('button', { name: 'Codex' }))
    fireEvent.click(screen.getByTestId('target-agent-picker'))
    fireEvent.click(await screen.findByRole('option', { name: /Claude Code/ }))
    await waitFor(() => expect(screen.getByTestId('target-agent-picker')).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: '项目' }))

    expect(screen.getByRole('button', { name: '迁移项目资料' })).toBeDisabled()
    expect(screen.getByLabelText('选择项目 app')).toBeDisabled()
  })

  it('closes the destination picker with Escape and restores trigger focus', async () => {
    render(<AgentMigration />)

    const trigger = await screen.findByTestId('target-agent-picker')
    fireEvent.click(trigger)
    await screen.findByRole('listbox', { name: '被迁移方' })
    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('listbox', { name: '被迁移方' })).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})

function scanFixture(targetAgentId: ExternalAgentId = 'cybercode'): AgentMigrationScan {
  return {
    scannedAt: '2026-07-13T00:00:00.000Z',
    targetAgentId,
    agents: [
      agent({ id: 'cybercode', name: 'CyberCode', installed: true }),
      agent({
        id: 'openclaw',
        name: 'OpenClaw',
        installed: true,
        items: [{
          id: 'openclaw-memory',
          agentId: 'openclaw',
          kind: 'memory',
          scope: 'global',
          name: 'MEMORY.md',
          sourcePath: '/Users/test/.openclaw/workspace/MEMORY.md',
          destinationPath: '/Users/test/.cyber/projects/home/memory/imports/openclaw/memory.md',
          destinationRoot: '/Users/test/.cyber',
          projectPath: null,
          sizeBytes: 128,
          modifiedAt: '2026-07-13T00:00:00.000Z',
          previewable: true,
          recommended: true,
          selectable: true,
          destinationState: 'ready',
          adaptation: 'native',
          destinationFormat: 'CyberCode searchable project memory',
          writeMode: 'markdown-file',
        }],
      }),
      agent({ id: 'workbuddy', name: 'WorkBuddy', installed: false }),
      agent({ id: 'claude-code', name: 'Claude Code', installed: true }),
      agent({
        id: 'codex',
        name: 'Codex',
        installed: true,
        projects: [{
          id: 'codex-project',
          agentId: 'codex',
          name: 'app',
          path: '/workspace/app',
          exists: true,
          itemIds: [],
          lastSeenAt: '2026-07-13T00:00:00.000Z',
        }],
      }),
      agent({ id: 'cursor', name: 'Cursor', installed: false }),
      agent({ id: 'trae', name: 'Trae', installed: false }),
      agent({ id: 'hermes-agent', name: 'Hermes Agent', installed: false }),
      agent({ id: 'deepseek-tui', name: 'DeepSeek TUI / CodeWhale', installed: false }),
      agent({ id: 'kimi-code', name: 'Kimi Code', installed: false }),
      agent({ id: 'pi', name: 'Pi', installed: false }),
    ],
  }
}

function agent(input: Partial<DetectedExternalAgent> & Pick<DetectedExternalAgent, 'id' | 'name' | 'installed'>): DetectedExternalAgent {
  const items = input.items ?? []
  const projects = input.projects ?? []
  return {
    id: input.id,
    name: input.name,
    installed: input.installed,
    executablePath: input.installed ? `/bin/${input.id}` : null,
    dataRoots: [],
    counts: {
      skills: items.filter(item => item.kind === 'skill').length,
      memories: items.filter(item => item.kind === 'memory').length,
      instructions: items.filter(item => item.kind === 'instruction').length,
      projects: projects.length,
    },
    items,
    projects,
  }
}
