import {
  ArrowRight,
  ArrowLeftRight,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  FileText,
  FolderGit2,
  MemoryStick,
  RefreshCw,
  Wrench,
} from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  agentMigrationApi,
  type AgentMigrationItem,
  type AgentMigrationProject,
  type AgentMigrationScan,
  type DetectedExternalAgent,
  type ExternalAgentId,
} from '../api/agentMigration'
import { Button } from '../components/shared/Button'
import { Modal } from '../components/shared/Modal'
import { SegmentedControl, SettingsPage } from '../components/settings/SettingsLayout'
import { useTranslation } from '../i18n'
import { formatBytes } from '../lib/formatBytes'
import { useUIStore } from '../stores/uiStore'

type Filter = 'all' | 'skill' | 'memory' | 'instruction' | 'project'

const DEFAULT_TARGET_AGENT_ID: ExternalAgentId = 'cybercode'
const ROUTE_FIELD_CLASS = 'mt-[2px] flex h-[40px] w-full min-w-0 items-center gap-[9px] rounded-[7px] border border-[var(--color-border)] bg-[var(--color-background)] px-[7px] text-left'
const ROUTE_ICON_CLASS = 'flex h-[28px] w-[28px] shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-[var(--color-surface-container)]'

const AGENT_VISUALS: Record<ExternalAgentId, { src: string; imageClass?: string }> = {
  cybercode: { src: '/app-icon.png' },
  openclaw: { src: '/agent-icons/openclaw.png', imageClass: 'p-[2px]' },
  'claude-code': { src: '/agent-icons/claude-code.png', imageClass: 'p-[7px]' },
  codex: { src: '/agent-icons/codex.png' },
  cursor: { src: '/agent-icons/cursor.png' },
  'hermes-agent': { src: '/agent-icons/hermes-agent.png' },
  'deepseek-tui': { src: '/agent-icons/codewhale.svg' },
}

export function AgentMigration() {
  const t = useTranslation()
  const addToast = useUIStore(state => state.addToast)
  const [agents, setAgents] = useState<DetectedExternalAgent[]>([])
  const [activeAgentId, setActiveAgentId] = useState<ExternalAgentId>('openclaw')
  const [targetAgentId, setTargetAgentId] = useState<ExternalAgentId>(DEFAULT_TARGET_AGENT_ID)
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [migrating, setMigrating] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{
    item: AgentMigrationItem
    content: string
    truncated: boolean
  } | null>(null)
  const [previewLoading, setPreviewLoading] = useState<string | null>(null)
  const loadRequestId = useRef(0)
  const scanCache = useRef(new Map<ExternalAgentId, AgentMigrationScan>())
  const sourceChosen = useRef(false)

  const load = useCallback(async ({
    quiet = false,
    force = false,
  }: { quiet?: boolean; force?: boolean } = {}) => {
    const requestId = ++loadRequestId.current
    if (!quiet) setLoading(true)
    setError(null)

    if (force) scanCache.current.clear()
    const applyScan = (scan: AgentMigrationScan) => {
      setAgents(scan.agents)
      setActiveAgentId(current => {
        if (sourceChosen.current
          && scan.agents.some(agent => agent.id === current && agent.installed && agent.id !== targetAgentId)) {
          return current
        }
        const withData = scan.agents.find(agent =>
          agent.installed
          && agent.id !== targetAgentId
          && (agent.items.length > 0 || agent.projects.length > 0))
        if (withData) return withData.id
        return scan.agents.find(agent => agent.installed && agent.id !== targetAgentId)?.id
          ?? scan.agents.find(agent => agent.id !== targetAgentId)?.id
          ?? 'openclaw'
      })
    }
    const cached = scanCache.current.get(targetAgentId)
    if (cached) {
      applyScan(cached)
      if (!quiet && requestId === loadRequestId.current) setLoading(false)
      return
    }

    try {
      const scan = await agentMigrationApi.scan(targetAgentId)
      if (requestId !== loadRequestId.current) return
      if (scan.targetAgentId !== targetAgentId) {
        throw new Error(t('agentMigration.loadFailed'))
      }
      scanCache.current.set(targetAgentId, scan)
      applyScan(scan)
    } catch (loadError) {
      if (requestId !== loadRequestId.current) return
      setAgents([])
      setError(errorMessage(loadError, t('agentMigration.loadFailed')))
    } finally {
      if (!quiet && requestId === loadRequestId.current) setLoading(false)
    }
  }, [t, targetAgentId])

  useEffect(() => {
    void load()
    return () => {
      loadRequestId.current += 1
    }
  }, [load])

  const activeAgent = agents.find(agent => agent.id === activeAgentId) ?? null
  const targetAgent = agents.find(agent => agent.id === targetAgentId) ?? null
  const visibleItems = useMemo(() => {
    if (!activeAgent || filter === 'project') return []
    if (filter === 'all') return activeAgent.items
    return activeAgent.items.filter(item => item.kind === filter)
  }, [activeAgent, filter])
  const selectableVisibleItems = visibleItems.filter(item => item.selectable)
  const selectableItemIds = useMemo(
    () => new Set(activeAgent?.items.filter(item => item.selectable).map(item => item.id) ?? []),
    [activeAgent],
  )
  const allVisibleSelected = selectableVisibleItems.length > 0
    && selectableVisibleItems.every(item => selectedItems.has(item.id))
  const selectionCount = selectedItems.size + selectedProjects.size
  const recommendedCount = activeAgent?.items.filter(
    item => item.scope === 'global' && item.recommended && item.selectable,
  ).length ?? 0

  const selectAgent = (agentId: ExternalAgentId) => {
    if (loading || migrating || agentId === targetAgentId) return
    sourceChosen.current = true
    const nextTarget = defaultTargetForSource(agentId, agents, targetAgentId)
    if (nextTarget !== targetAgentId) {
      setLoading(true)
      setTargetAgentId(nextTarget)
    }
    setError(null)
    setActiveAgentId(agentId)
    setSelectedItems(new Set())
    setSelectedProjects(new Set())
    setFilter('all')
    setPreview(null)
  }

  const selectTarget = (agentId: ExternalAgentId) => {
    if (loading || migrating || agentId === activeAgentId || agentId === targetAgentId) return
    sourceChosen.current = true
    setLoading(true)
    setTargetAgentId(agentId)
    setSelectedItems(new Set())
    setSelectedProjects(new Set())
    setFilter('all')
    setPreview(null)
  }

  const swapDirection = () => {
    if (!activeAgent?.installed || !targetAgent?.installed || migrating) return
    sourceChosen.current = true
    const nextSource = targetAgentId
    setLoading(true)
    setTargetAgentId(activeAgent.id)
    setActiveAgentId(nextSource)
    setSelectedItems(new Set())
    setSelectedProjects(new Set())
    setFilter('all')
    setPreview(null)
  }

  const toggleItem = (itemId: string) => {
    setSelectedItems(current => toggleSetValue(current, itemId))
  }

  const toggleProject = (projectId: string) => {
    setSelectedProjects(current => toggleSetValue(current, projectId))
  }

  const toggleVisibleItems = () => {
    setSelectedItems(current => {
      const next = new Set(current)
      if (allVisibleSelected) selectableVisibleItems.forEach(item => next.delete(item.id))
      else selectableVisibleItems.forEach(item => next.add(item.id))
      return next
    })
  }

  const runMigration = async (input: {
    itemIds?: string[]
    projectIds?: string[]
    allRecommended?: boolean
  }, busyKey: string) => {
    if (!activeAgent || migrating) return
    setMigrating(busyKey)
    setError(null)
    try {
      const result = await agentMigrationApi.migrate({
        agentId: activeAgent.id,
        targetAgentId,
        ...input,
      })
      const summary = result.failed > 0
        ? t('agentMigration.resultPartial', { imported: result.imported, failed: result.failed })
        : t('agentMigration.resultSuccess', { imported: result.imported, skipped: result.skipped })
      const itemMessage = result.items.find(item => item.message)?.message
      const registeredMessage = result.registeredProjects.length > 0
        ? t('agentMigration.projectsRegistered', { count: result.registeredProjects.length })
        : ''
      const message = [summary, registeredMessage, itemMessage].filter(Boolean).join(' ')
      addToast({ type: result.failed > 0 || itemMessage ? 'warning' : 'success', message })
      setSelectedItems(new Set())
      setSelectedProjects(new Set())
      await load({ quiet: true, force: true })
    } catch (migrationError) {
      const message = errorMessage(migrationError, t('agentMigration.migrateFailed'))
      setError(message)
      addToast({ type: 'error', message })
    } finally {
      setMigrating(null)
    }
  }

  const showPreview = async (item: AgentMigrationItem) => {
    if (!item.previewable || previewLoading) return
    setPreviewLoading(item.id)
    try {
      setPreview(await agentMigrationApi.preview(item.agentId, item.id, targetAgentId))
    } catch (previewError) {
      addToast({ type: 'error', message: errorMessage(previewError, t('agentMigration.previewFailed')) })
    } finally {
      setPreviewLoading(null)
    }
  }

  return (
    <SettingsPage
      title={t('agentMigration.title')}
      description={t('agentMigration.description')}
    >
      <section className="overflow-hidden rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container)]">
        <MigrationRoute
          agents={agents}
          source={activeAgent}
          target={targetAgent}
          targetAgentId={targetAgentId}
          disabled={loading || Boolean(migrating)}
          onSelectTarget={selectTarget}
          onSwap={swapDirection}
        />
        <div className="grid min-h-[520px] grid-cols-1 md:grid-cols-[224px_minmax(0,1fr)]">
          <aside className="border-b border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] md:border-b-0 md:border-r">
            <div className="flex h-[50px] items-center justify-between border-b border-[var(--color-border-separator)] px-[14px]">
              <span className="text-[11px] font-bold text-[var(--color-text-tertiary)]">
                {t('agentMigration.sources')}
              </span>
              <button
                type="button"
                onClick={() => void load({ force: true })}
                disabled={loading || Boolean(migrating)}
                aria-label={t('agentMigration.rescan')}
                title={t('agentMigration.rescan')}
                className="flex h-[30px] w-[30px] items-center justify-center rounded-[7px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-40"
              >
                <RefreshCw size={15} className={loading ? 'animate-spin' : undefined} />
              </button>
            </div>
            <div className="flex gap-[6px] overflow-x-auto p-[8px] md:flex-col md:overflow-x-visible">
              {agents.map(agent => (
                <AgentSourceRow
                  key={agent.id}
                  agent={agent}
                  active={agent.id === activeAgentId}
                  isTarget={agent.id === targetAgentId}
                  busy={loading || Boolean(migrating)}
                  onClick={() => selectAgent(agent.id)}
                />
              ))}
            </div>
          </aside>

          <div className="min-w-0">
            {loading ? (
              <LoadingState label={t('agentMigration.scanning')} />
            ) : activeAgent ? (
              <>
                <AgentHeader
                  agent={activeAgent}
                  targetName={targetAgent?.name ?? 'CyberCode'}
                  recommendedCount={recommendedCount}
                  disabled={loading || Boolean(migrating)}
                  migrating={migrating === 'recommended'}
                  onMigrateRecommended={() => void runMigration({ allRecommended: true }, 'recommended')}
                />

                <div className="flex flex-wrap items-center justify-between gap-[10px] border-b border-[var(--color-border-separator)] px-[14px] py-[10px]">
                  <div className="max-w-full overflow-x-auto pb-[2px]">
                    <SegmentedControl
                      value={filter}
                      onChange={setFilter}
                      items={[
                        { value: 'all', label: t('agentMigration.filter.all') },
                        { value: 'skill', label: t('agentMigration.filter.skills') },
                        { value: 'memory', label: t('agentMigration.filter.memories') },
                        { value: 'instruction', label: t('agentMigration.filter.instructions') },
                        { value: 'project', label: t('agentMigration.filter.projects') },
                      ]}
                    />
                  </div>
                  {filter !== 'project' && selectableVisibleItems.length > 0 && (
                    <label className="flex cursor-pointer items-center gap-[7px] text-[11px] text-[var(--color-text-secondary)]">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        disabled={Boolean(migrating)}
                        onChange={toggleVisibleItems}
                        className="h-[15px] w-[15px] accent-black disabled:cursor-not-allowed disabled:opacity-35 dark:accent-white"
                      />
                      {t('agentMigration.selectVisible')}
                    </label>
                  )}
                </div>

                <div className="max-h-[430px] min-h-[280px] overflow-y-auto">
                  {filter === 'project' ? (
                    <ProjectList
                      projects={activeAgent.projects}
                      selectableItemIds={selectableItemIds}
                      selected={selectedProjects}
                      migrating={loading ? 'loading' : migrating}
                      registersProjects={targetAgentId === 'cybercode'}
                      onToggle={toggleProject}
                      onMigrate={project => void runMigration({ projectIds: [project.id] }, `project:${project.id}`)}
                    />
                  ) : (
                    <MigrationItemList
                      items={visibleItems}
                      selected={selectedItems}
                      migrating={loading ? 'loading' : migrating}
                      previewLoading={previewLoading}
                      onToggle={toggleItem}
                      onPreview={item => void showPreview(item)}
                      onMigrate={item => void runMigration({ itemIds: [item.id] }, `item:${item.id}`)}
                    />
                  )}
                </div>

                <footer className="flex min-h-[62px] flex-wrap items-center justify-between gap-[10px] border-t border-[var(--color-border-separator)] px-[16px] py-[10px]">
                  <span className="text-[11px] text-[var(--color-text-tertiary)]">
                    {t('agentMigration.selectedCount', { count: selectionCount })}
                  </span>
                  <Button
                    size="sm"
                    disabled={selectionCount === 0 || loading || Boolean(migrating)}
                    loading={migrating === 'selected'}
                    icon={<ArrowRight size={15} />}
                    onClick={() => void runMigration({
                      itemIds: [...selectedItems],
                      projectIds: [...selectedProjects],
                    }, 'selected')}
                  >
                    {t('agentMigration.migrateSelected')}
                  </Button>
                </footer>
              </>
            ) : (
              <EmptyState label={t('agentMigration.noneDetected')} />
            )}
          </div>
        </div>
      </section>

      {error && (
        <div role="alert" className="rounded-[8px] border border-[var(--color-error)]/25 bg-[var(--color-error)]/5 px-[14px] py-[11px] text-[12px] text-[var(--color-error)]">
          {error}
        </div>
      )}

      <Modal
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview?.item.name}
        width={760}
      >
        {preview && (
          <div className="space-y-[14px]">
            <PathPair source={preview.item.sourcePath} destination={preview.item.destinationPath} />
            <pre className="max-h-[52vh] overflow-auto whitespace-pre-wrap break-words rounded-[8px] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] p-[14px] font-mono text-[11px] leading-[18px] text-[var(--color-text-primary)]">
              {preview.content}
            </pre>
            {preview.truncated && (
              <p className="text-[11px] text-[var(--color-text-tertiary)]">{t('agentMigration.previewTruncated')}</p>
            )}
          </div>
        )}
      </Modal>
    </SettingsPage>
  )
}

function MigrationRoute({
  agents,
  source,
  target,
  targetAgentId,
  disabled,
  onSelectTarget,
  onSwap,
}: {
  agents: DetectedExternalAgent[]
  source: DetectedExternalAgent | null
  target: DetectedExternalAgent | null
  targetAgentId: ExternalAgentId
  disabled: boolean
  onSelectTarget: (agentId: ExternalAgentId) => void
  onSwap: () => void
}) {
  const t = useTranslation()
  return (
    <div className="grid min-h-[70px] grid-cols-[minmax(0,1fr)_40px_minmax(0,1fr)] items-end gap-[10px] border-b border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] px-[14px] py-[9px]">
      <div className="min-w-0">
        <span className="block text-[9px] font-bold text-[var(--color-text-tertiary)]">
          {t('agentMigration.sourceAgent')}
        </span>
        <div data-testid="source-agent-field" className={ROUTE_FIELD_CLASS}>
          <span className={ROUTE_ICON_CLASS}>
            {source && <AgentBrandImage agentId={source.id} />}
          </span>
          <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-[var(--color-text-primary)]">
            {source?.name ?? t('agentMigration.scanning')}
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={onSwap}
        disabled={disabled || !source?.installed || !target?.installed}
        aria-label={t('agentMigration.swapDirection')}
        title={t('agentMigration.swapDirection')}
        className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-[7px] border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-35"
      >
        <ArrowLeftRight size={15} />
      </button>

      <AgentTargetPicker
        agents={agents}
        source={source}
        target={target}
        targetAgentId={targetAgentId}
        disabled={disabled}
        onSelect={onSelectTarget}
      />
    </div>
  )
}

type TargetPickerPosition = {
  top: number
  left: number
  width: number
  maxHeight: number
  direction: 'up' | 'down'
}

function AgentTargetPicker({
  agents,
  source,
  target,
  targetAgentId,
  disabled,
  onSelect,
}: {
  agents: DetectedExternalAgent[]
  source: DetectedExternalAgent | null
  target: DetectedExternalAgent | null
  targetAgentId: ExternalAgentId
  disabled: boolean
  onSelect: (agentId: ExternalAgentId) => void
}) {
  const t = useTranslation()
  const listboxId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [position, setPosition] = useState<TargetPickerPosition | null>(null)
  const targetName = target?.name ?? t('agentMigration.scanning')

  const enabledIndices = useMemo(
    () => agents
      .map((agent, index) => agent.installed && agent.id !== source?.id ? index : -1)
      .filter(index => index >= 0),
    [agents, source?.id],
  )

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const viewportPadding = 12
    const availableWidth = Math.max(220, window.innerWidth - viewportPadding * 2)
    const width = Math.min(Math.max(rect.width, 300), availableWidth)
    const left = Math.min(
      Math.max(viewportPadding, rect.right - width),
      Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
    )
    const spaceAbove = rect.top - viewportPadding
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding
    const direction = spaceBelow >= 320 || spaceBelow >= spaceAbove ? 'down' : 'up'
    const availableHeight = direction === 'down' ? spaceBelow : spaceAbove
    setPosition({
      top: direction === 'down' ? rect.bottom + 6 : rect.top - 6,
      left,
      width,
      maxHeight: Math.max(160, Math.min(360, availableHeight)),
      direction,
    })
  }, [])

  const close = useCallback((restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) window.setTimeout(() => triggerRef.current?.focus(), 0)
  }, [])

  const show = (direction: 'first' | 'last' | 'selected' = 'selected') => {
    if (disabled || agents.length === 0) return
    const selectedIndex = agents.findIndex(agent => agent.id === targetAgentId)
    const nextIndex = direction === 'first'
      ? enabledIndices[0]
      : direction === 'last'
        ? enabledIndices[enabledIndices.length - 1]
        : enabledIndices.includes(selectedIndex) ? selectedIndex : enabledIndices[0]
    if (nextIndex === undefined) return
    setActiveIndex(nextIndex)
    updatePosition()
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    updatePosition()
    const handlePointerDown = (event: MouseEvent) => {
      const node = event.target as Node
      if (triggerRef.current?.contains(node) || menuRef.current?.contains(node)) return
      close()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      close(true)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [close, open, updatePosition])

  useEffect(() => {
    if (disabled && open) close()
  }, [close, disabled, open])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => optionRefs.current[activeIndex]?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [activeIndex, open])

  const moveFocus = (direction: 1 | -1) => {
    const current = enabledIndices.indexOf(activeIndex)
    const currentPosition = current >= 0 ? current : 0
    const nextPosition = (currentPosition + direction + enabledIndices.length) % enabledIndices.length
    const nextIndex = enabledIndices[nextPosition]
    if (nextIndex !== undefined) setActiveIndex(nextIndex)
  }

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const nextIndex = event.key === 'Home'
        ? enabledIndices[0]
        : enabledIndices[enabledIndices.length - 1]
      if (nextIndex !== undefined) setActiveIndex(nextIndex)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const agent = agents[activeIndex]
      if (agent) choose(agent)
      return
    }
    if (event.key === 'Tab') close()
  }

  const choose = (agent: DetectedExternalAgent) => {
    if (!agent.installed || agent.id === source?.id) return
    close(true)
    onSelect(agent.id)
  }

  return (
    <div className="min-w-0">
      <span className="block text-[9px] font-bold text-[var(--color-text-tertiary)]">
        {t('agentMigration.targetAgent')}
      </span>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled || agents.length === 0}
        aria-label={`${t('agentMigration.targetAgent')}: ${targetName}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        data-testid="target-agent-picker"
        data-target-agent={targetAgentId}
        onClick={() => open ? close() : show()}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            show(event.key === 'ArrowDown' ? 'first' : 'last')
          }
        }}
        className={`${ROUTE_FIELD_CLASS} transition-colors hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)] focus-visible:border-[var(--color-border-focus)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)] disabled:cursor-not-allowed disabled:opacity-55`}
      >
        <span className={ROUTE_ICON_CLASS}>
          <AgentBrandImage agentId={targetAgentId} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-[var(--color-text-primary)]">
          {targetName}
        </span>
        <ChevronDown
          size={15}
          className={`shrink-0 text-[var(--color-text-tertiary)] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && position && createPortal(
        <div
          ref={menuRef}
          id={listboxId}
          role="listbox"
          aria-label={t('agentMigration.targetAgent')}
          onKeyDown={handleMenuKeyDown}
          className="settings-ui native-ui-text overflow-y-auto rounded-[8px] border border-[var(--color-border-separator)] bg-[var(--color-background)] p-[5px] shadow-[var(--shadow-dropdown)]"
          style={{
            position: 'fixed',
            left: position.left,
            width: position.width,
            maxHeight: position.maxHeight,
            ...(position.direction === 'down'
              ? { top: position.top }
              : { bottom: window.innerHeight - position.top }),
            zIndex: 9999,
          }}
        >
          {agents.map((agent, index) => {
            const isSource = agent.id === source?.id
            const unavailable = disabled || !agent.installed || isSource
            const selected = agent.id === targetAgentId
            const isDefault = agent.id === DEFAULT_TARGET_AGENT_ID && !isSource
            return (
              <button
                key={agent.id}
                ref={element => { optionRefs.current[index] = element }}
                type="button"
                role="option"
                aria-selected={selected}
                aria-disabled={unavailable}
                disabled={unavailable}
                onMouseEnter={() => { if (!unavailable) setActiveIndex(index) }}
                onClick={() => choose(agent)}
                className={`flex min-h-[50px] w-full items-center gap-[10px] rounded-[6px] px-[9px] py-[7px] text-left outline-none transition-colors ${
                  unavailable
                    ? 'cursor-not-allowed opacity-40'
                    : index === activeIndex || selected
                      ? 'bg-[var(--color-surface-selected)]'
                      : 'hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                <span className="flex h-[32px] w-[32px] shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-[var(--color-surface-container-low)]">
                  <AgentBrandImage agentId={agent.id} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-[6px]">
                    <span className="truncate text-[12px] font-bold text-[var(--color-text-primary)]">{agent.name}</span>
                    {isDefault && (
                      <span className="shrink-0 rounded-[4px] bg-[var(--color-surface-container-low)] px-[5px] py-[1px] text-[9px] font-bold text-[var(--color-text-tertiary)]">
                        {t('agentMigration.defaultTarget')}
                      </span>
                    )}
                  </span>
                  <span className="mt-[1px] block truncate text-[10px] text-[var(--color-text-tertiary)]">
                    {isSource
                      ? t('agentMigration.currentSource')
                      : agent.installed
                        ? t('agentMigration.detected')
                        : t('agentMigration.notDetected')}
                  </span>
                </span>
                {selected && <Check size={15} className="shrink-0 text-[var(--color-text-secondary)]" />}
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}

function AgentSourceRow({
  agent,
  active,
  isTarget,
  busy,
  onClick,
}: {
  agent: DetectedExternalAgent
  active: boolean
  isTarget: boolean
  busy: boolean
  onClick: () => void
}) {
  const t = useTranslation()
  const total = agent.counts.skills + agent.counts.memories + agent.counts.instructions
  const disabled = isTarget || busy
  const summary = agent.counts.projects > 0
    ? t('agentMigration.detectedFilesAndProjects', {
        count: total,
        projects: agent.counts.projects,
      })
    : t('agentMigration.detectedCount', { count: total })

  return (
    <button
      type="button"
      aria-label={agent.name}
      onClick={onClick}
      disabled={disabled}
      className={`flex min-w-[190px] items-center gap-[10px] rounded-[7px] px-[10px] py-[9px] text-left transition-colors md:min-w-0 ${
        active
          ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]'
          : isTarget
            ? 'cursor-not-allowed text-[var(--color-text-tertiary)] opacity-55'
            : busy
              ? 'cursor-wait text-[var(--color-text-secondary)] opacity-65'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
      }`}
    >
      <span className="relative flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[7px] bg-[var(--color-surface-container-low)]">
        <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-[7px]">
          <AgentBrandImage agentId={agent.id} />
        </span>
        {agent.installed && <span className="absolute -bottom-[2px] -right-[2px] h-[8px] w-[8px] rounded-full border-2 border-[var(--color-surface-container-low)] bg-[var(--color-success)]" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-bold">{agent.name}</span>
        <span className="mt-[2px] block truncate text-[10px] text-[var(--color-text-tertiary)]">
          {isTarget
            ? t('agentMigration.currentTarget')
            : agent.installed
            ? summary
            : t('agentMigration.notDetected')}
        </span>
      </span>
      <ChevronRight size={14} className={active ? 'opacity-80' : 'opacity-30'} />
    </button>
  )
}

function AgentHeader({
  agent,
  targetName,
  recommendedCount,
  disabled,
  migrating,
  onMigrateRecommended,
}: {
  agent: DetectedExternalAgent
  targetName: string
  recommendedCount: number
  disabled: boolean
  migrating: boolean
  onMigrateRecommended: () => void
}) {
  const t = useTranslation()

  return (
    <header className="flex min-h-[86px] flex-wrap items-center justify-between gap-[14px] border-b border-[var(--color-border-separator)] px-[16px] py-[14px]">
      <div className="flex min-w-0 items-center gap-[11px]">
        <span className="flex h-[40px] w-[40px] shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-[var(--color-surface-container-low)]">
          <AgentBrandImage agentId={agent.id} />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-[8px]">
            <h2 className="truncate text-[15px] font-bold text-[var(--color-text-primary)]">{agent.name}</h2>
            <span className={`rounded-full px-[7px] py-[2px] text-[9px] font-bold ${
              agent.installed
                ? 'bg-[var(--color-success)]/10 text-[var(--color-success)]'
                : 'bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)]'
            }`}>
              {agent.installed ? t('agentMigration.detected') : t('agentMigration.notDetected')}
            </span>
          </div>
          <p className="mt-[4px] truncate font-mono text-[10px] text-[var(--color-text-tertiary)]" title={agent.executablePath ?? agent.dataRoots[0]}>
            {agent.executablePath ?? agent.dataRoots[0] ?? t('agentMigration.noData')}
          </p>
        </div>
      </div>
      <Button
        size="sm"
        variant="secondary"
        disabled={disabled || !agent.installed || recommendedCount === 0}
        loading={migrating}
        icon={<Check size={15} />}
        onClick={onMigrateRecommended}
      >
        {t('agentMigration.oneClick', { count: recommendedCount, target: targetName })}
      </Button>
    </header>
  )
}

function AgentBrandImage({ agentId }: { agentId: ExternalAgentId }) {
  const visual = AGENT_VISUALS[agentId]
  return (
    <img
      src={visual.src}
      alt=""
      aria-hidden="true"
      draggable={false}
      data-agent-logo={agentId}
      className={`h-full w-full object-contain ${visual.imageClass ?? ''}`}
    />
  )
}

function MigrationItemList({
  items,
  selected,
  migrating,
  previewLoading,
  onToggle,
  onPreview,
  onMigrate,
}: {
  items: AgentMigrationItem[]
  selected: Set<string>
  migrating: string | null
  previewLoading: string | null
  onToggle: (id: string) => void
  onPreview: (item: AgentMigrationItem) => void
  onMigrate: (item: AgentMigrationItem) => void
}) {
  const t = useTranslation()
  if (items.length === 0) return <EmptyState label={t('agentMigration.noItems')} />

  return (
    <div className="divide-y divide-[var(--color-border-separator)]">
      {items.map(item => {
        const KindIcon = item.kind === 'skill' ? Wrench : item.kind === 'memory' ? MemoryStick : FileText
        const destinationLabel = item.destinationState === 'merge'
          ? t('agentMigration.willMerge')
          : item.destinationState === 'exists'
            ? t('agentMigration.existing')
            : item.destinationState === 'conflict'
              ? t('agentMigration.destinationConflict')
              : null
        return (
          <div key={item.id} className="flex min-w-0 items-center gap-[10px] px-[14px] py-[11px] hover:bg-[var(--color-surface-hover)]/55">
            <input
              type="checkbox"
              checked={selected.has(item.id)}
              disabled={!item.selectable || Boolean(migrating)}
              onChange={() => onToggle(item.id)}
              aria-label={t('agentMigration.selectItem', { name: item.name })}
              className="h-[15px] w-[15px] shrink-0 accent-black disabled:opacity-35 dark:accent-white"
            />
            <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[6px] bg-[var(--color-surface-container-low)] text-[var(--color-text-secondary)]">
              <KindIcon size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-[7px]">
                <span className="truncate text-[12px] font-bold text-[var(--color-text-primary)]">{item.name}</span>
                <span className="shrink-0 rounded-[4px] bg-[var(--color-surface-container-low)] px-[5px] py-[1px] text-[9px] font-bold text-[var(--color-text-tertiary)]">
                  {kindLabel(item, t)}
                </span>
                <span
                  title={[item.destinationFormat, item.compatibilityNote].filter(Boolean).join('\n')}
                  className={`shrink-0 rounded-[4px] px-[5px] py-[1px] text-[9px] font-bold ${
                    item.adaptation === 'native'
                      ? 'bg-[var(--color-success-container)] text-[var(--color-success)]'
                      : 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]'
                  }`}
                >
                  {item.adaptation === 'native'
                    ? t('agentMigration.nativeFormat')
                    : t('agentMigration.convertedFormat')}
                </span>
                {destinationLabel && (
                  <span className={`shrink-0 text-[9px] font-bold ${
                    item.destinationState === 'conflict'
                      ? 'text-[var(--color-error)]'
                      : 'text-[var(--color-warning)]'
                  }`}>
                    {destinationLabel}
                  </span>
                )}
                {item.selectionIssue === 'size-limit' && (
                  <span className="shrink-0 text-[9px] font-bold text-[var(--color-warning)]">
                    {t('agentMigration.sizeLimit')}
                  </span>
                )}
              </div>
              <div className="mt-[3px] flex min-w-0 items-center gap-[8px] text-[10px] text-[var(--color-text-tertiary)]">
                <span className="truncate font-mono" title={item.sourcePath}>{compactPath(item.sourcePath)}</span>
                <span className="shrink-0">{formatBytes(item.sizeBytes)}</span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-[2px]">
              <IconButton
                label={t('agentMigration.preview')}
                disabled={!item.previewable || Boolean(previewLoading) || Boolean(migrating)}
                onClick={() => onPreview(item)}
              >
                <Eye size={15} className={previewLoading === item.id ? 'animate-pulse' : undefined} />
              </IconButton>
              <IconButton
                label={t('agentMigration.migrateOne')}
                disabled={!item.selectable || Boolean(migrating)}
                onClick={() => onMigrate(item)}
              >
                <ArrowRight size={15} className={migrating === `item:${item.id}` ? 'animate-pulse' : undefined} />
              </IconButton>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ProjectList({
  projects,
  selectableItemIds,
  selected,
  migrating,
  registersProjects,
  onToggle,
  onMigrate,
}: {
  projects: AgentMigrationProject[]
  selectableItemIds: Set<string>
  selected: Set<string>
  migrating: string | null
  registersProjects: boolean
  onToggle: (id: string) => void
  onMigrate: (project: AgentMigrationProject) => void
}) {
  const t = useTranslation()
  if (projects.length === 0) return <EmptyState label={t('agentMigration.noProjects')} />
  return (
    <div className="divide-y divide-[var(--color-border-separator)]">
      {projects.map(project => {
        const canMigrate = project.exists && (
          registersProjects || project.itemIds.some(itemId => selectableItemIds.has(itemId))
        )
        return (
        <div key={project.id} className="flex min-w-0 items-center gap-[10px] px-[14px] py-[12px] hover:bg-[var(--color-surface-hover)]/55">
          <input
            type="checkbox"
            checked={selected.has(project.id)}
            disabled={!canMigrate || Boolean(migrating)}
            onChange={() => onToggle(project.id)}
            aria-label={t('agentMigration.selectProject', { name: project.name })}
            className="h-[15px] w-[15px] shrink-0 accent-black disabled:opacity-35 dark:accent-white"
          />
          <span className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[6px] bg-[var(--color-surface-container-low)] text-[var(--color-text-secondary)]">
            <FolderGit2 size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-[7px]">
              <span className="truncate text-[12px] font-bold text-[var(--color-text-primary)]">{project.name}</span>
              <span className="shrink-0 text-[9px] text-[var(--color-text-tertiary)]">
                {t('agentMigration.projectFiles', { count: project.itemIds.length })}
              </span>
              {!project.exists && <span className="shrink-0 text-[9px] font-bold text-[var(--color-warning)]">{t('agentMigration.pathMissing')}</span>}
            </div>
            <p className="mt-[3px] truncate font-mono text-[10px] text-[var(--color-text-tertiary)]" title={project.path}>{project.path}</p>
          </div>
          <IconButton
            label={registersProjects ? t('agentMigration.migrateProject') : t('agentMigration.migrateProjectData')}
            disabled={!canMigrate || Boolean(migrating)}
            onClick={() => onMigrate(project)}
          >
            <ArrowRight size={15} className={migrating === `project:${project.id}` ? 'animate-pulse' : undefined} />
          </IconButton>
        </div>
        )
      })}
    </div>
  )
}

function PathPair({ source, destination }: { source: string; destination: string }) {
  const t = useTranslation()
  return (
    <div className="grid gap-[8px] rounded-[8px] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] p-[12px] text-[10px] sm:grid-cols-[80px_minmax(0,1fr)]">
      <span className="font-bold text-[var(--color-text-tertiary)]">{t('agentMigration.sourcePath')}</span>
      <code className="break-all text-[var(--color-text-secondary)]">{source}</code>
      <span className="font-bold text-[var(--color-text-tertiary)]">{t('agentMigration.destinationPath')}</span>
      <code className="break-all text-[var(--color-text-secondary)]">{destination}</code>
    </div>
  )
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-[30px] w-[30px] items-center justify-center rounded-[6px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-selected)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  )
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex min-h-[420px] items-center justify-center gap-[9px] text-[12px] text-[var(--color-text-secondary)]">
      <RefreshCw size={16} className="animate-spin" />
      {label}
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center gap-[10px] px-[24px] text-center text-[12px] text-[var(--color-text-tertiary)]">
      <Bot size={23} strokeWidth={1.4} />
      {label}
    </div>
  )
}

function kindLabel(item: AgentMigrationItem, t: ReturnType<typeof useTranslation>): string {
  const kind = item.kind === 'skill'
    ? t('agentMigration.kind.skill')
    : item.kind === 'memory'
      ? t('agentMigration.kind.memory')
      : t('agentMigration.kind.instruction')
  return item.scope === 'project' ? `${kind} · ${t('agentMigration.scope.project')}` : kind
}

function defaultTargetForSource(
  sourceAgentId: ExternalAgentId,
  agents: DetectedExternalAgent[],
  currentTargetAgentId: ExternalAgentId,
): ExternalAgentId {
  const isInstalled = (agentId: ExternalAgentId) => agents.some(
    agent => agent.id === agentId && agent.installed,
  )

  if (sourceAgentId !== DEFAULT_TARGET_AGENT_ID && isInstalled(DEFAULT_TARGET_AGENT_ID)) {
    return DEFAULT_TARGET_AGENT_ID
  }
  if (currentTargetAgentId !== sourceAgentId && isInstalled(currentTargetAgentId)) {
    return currentTargetAgentId
  }
  return agents.find(agent => agent.installed && agent.id !== sourceAgentId)?.id
    ?? currentTargetAgentId
}

function toggleSetValue(current: Set<string>, value: string): Set<string> {
  const next = new Set(current)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

function compactPath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length <= 4) return path
  return `.../${parts.slice(-4).join('/')}`
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
