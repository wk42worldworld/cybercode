import {
  AlertCircle,
  BookOpen,
  Database,
  File,
  FilePlus2,
  Files,
  Folder,
  FolderPlus,
  LoaderCircle,
  Network,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react'
import {
  knowledgeApi,
  type KnowledgeDocument,
  type KnowledgeSearchResult,
  type KnowledgeSource,
  type KnowledgeStats,
} from '../api/knowledge'
import {
  tokenOptimizationApi,
  type CodeGraphData,
  type CodeGraphStatus,
} from '../api/tokenOptimization'
import { CodeGraphVisualization } from '../components/codegraph/CodeGraphVisualization'
import { useTranslation } from '../i18n'
import { formatBytes } from '../lib/formatBytes'
import { isTauriRuntime } from '../lib/desktopRuntime'
import { useSessionStore } from '../stores/sessionStore'
import { useTabStore } from '../stores/tabStore'
import { useUIStore } from '../stores/uiStore'

type WorkspaceMode = 'graph' | 'files' | 'search'

const EMPTY_STATS: KnowledgeStats = {
  sourceCount: 0,
  documentCount: 0,
  chunkCount: 0,
  sizeBytes: 0,
  indexingCount: 0,
}

export function KnowledgeSpace() {
  const t = useTranslation()
  const activeTabId = useTabStore((state) => state.activeTabId)
  const tabs = useTabStore((state) => state.tabs)
  const sessions = useSessionStore((state) => state.sessions)
  const [mode, setMode] = useState<WorkspaceMode>('graph')
  const [sources, setSources] = useState<KnowledgeSource[]>([])
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [stats, setStats] = useState<KnowledgeStats>(EMPTY_STATS)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<KnowledgeSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [loadingSources, setLoadingSources] = useState(true)
  const [sourceActionId, setSourceActionId] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [graphStatus, setGraphStatus] = useState<CodeGraphStatus | null>(null)
  const [graph, setGraph] = useState<CodeGraphData | null>(null)
  const [graphLoading, setGraphLoading] = useState(false)
  const [graphActionLoading, setGraphActionLoading] = useState(false)
  const graphRequestRef = useRef(0)
  const sourceLoadRequestRef = useRef(0)

  const projectPath = useMemo(() => {
    const activeTab = tabs.find((tab) => tab.sessionId === activeTabId)
    if (!activeTab || activeTab.type !== 'session') return null
    const session = sessions.find((candidate) =>
      candidate.id === activeTab.sessionId
      && (!activeTab.projectPath || candidate.projectPath === activeTab.projectPath),
    )
    return session?.workDir || null
  }, [activeTabId, sessions, tabs])

  const selectedSource = useMemo(
    () => sources.find((source) => source.id === selectedSourceId) ?? null,
    [selectedSourceId, sources],
  )

  const notifyError = useCallback((error: unknown, fallback: string) => {
    useUIStore.getState().addToast({
      type: 'error',
      message: error instanceof Error ? error.message : fallback,
    })
  }, [])

  const loadSources = useCallback(async (quiet = false) => {
    const requestId = ++sourceLoadRequestRef.current
    if (!quiet) setLoadingSources(true)
    try {
      const [nextSources, nextStats] = await Promise.all([
        knowledgeApi.sources(),
        knowledgeApi.stats(),
      ])
      if (sourceLoadRequestRef.current !== requestId) return
      setSources(nextSources)
      setStats(nextStats)
      setSelectedSourceId((current) =>
        current && nextSources.some((source) => source.id === current) ? current : null,
      )
    } catch (error) {
      if (!quiet && sourceLoadRequestRef.current === requestId) {
        notifyError(error, t('knowledgeSpace.errors.load'))
      }
    } finally {
      if (!quiet && sourceLoadRequestRef.current === requestId) setLoadingSources(false)
    }
  }, [notifyError, t])

  useEffect(() => {
    void loadSources()
  }, [loadSources])

  useEffect(() => {
    if (!sources.some((source) => source.status === 'pending' || source.status === 'indexing')) return
    const timer = window.setInterval(() => void loadSources(true), 1_000)
    return () => window.clearInterval(timer)
  }, [loadSources, sources])

  useEffect(() => {
    if (mode !== 'files') return
    let active = true
    void knowledgeApi.documents(selectedSourceId || undefined)
      .then((nextDocuments) => {
        if (active) setDocuments(nextDocuments)
      })
      .catch((error) => {
        if (active) notifyError(error, t('knowledgeSpace.errors.load'))
      })
    return () => {
      active = false
    }
  }, [mode, notifyError, selectedSourceId, sources, t])

  useEffect(() => {
    if (mode !== 'search' || !searchQuery.trim()) {
      setSearchResults([])
      setSearching(false)
      return
    }
    let active = true
    setSearching(true)
    const timer = window.setTimeout(() => {
      void knowledgeApi.search(searchQuery, selectedSourceId || undefined)
        .then((results) => {
          if (active) setSearchResults(results)
        })
        .catch((error) => {
          if (active) notifyError(error, t('knowledgeSpace.errors.search'))
        })
        .finally(() => {
          if (active) setSearching(false)
        })
    }, 220)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [mode, notifyError, searchQuery, selectedSourceId, t])

  const loadGraphStatus = useCallback(async (quiet = false) => {
    const requestPath = projectPath
    const requestId = ++graphRequestRef.current
    if (!requestPath) {
      setGraphStatus(null)
      setGraph(null)
      return
    }
    try {
      const nextStatus = await tokenOptimizationApi.status(requestPath)
      if (graphRequestRef.current !== requestId) return
      setGraphStatus(nextStatus)
    } catch (error) {
      if (!quiet && graphRequestRef.current === requestId) {
        notifyError(error, t('knowledgeSpace.errors.graph'))
      }
    }
  }, [notifyError, projectPath, t])

  useEffect(() => {
    graphRequestRef.current += 1
    setGraph(null)
    setGraphStatus(null)
    void loadGraphStatus()
  }, [loadGraphStatus, projectPath])

  useEffect(() => {
    if (!graphStatus || !['preparing', 'indexing', 'empty'].includes(graphStatus.state)) return
    const interval = graphStatus.state === 'empty' ? 2_000 : 800
    const timer = window.setInterval(() => void loadGraphStatus(true), interval)
    return () => window.clearInterval(timer)
  }, [graphStatus, loadGraphStatus])

  useEffect(() => {
    if (!projectPath || graphStatus?.state !== 'ready') return
    let active = true
    setGraphLoading(true)
    void tokenOptimizationApi.graph(projectPath, 180)
      .then((nextGraph) => {
        if (active) setGraph(nextGraph)
      })
      .catch((error) => {
        if (active) notifyError(error, t('knowledgeSpace.errors.graph'))
      })
      .finally(() => {
        if (active) setGraphLoading(false)
      })
    return () => {
      active = false
    }
  }, [graphStatus?.state, notifyError, projectPath, t])

  const addSourcePaths = useCallback(async (paths: string[]) => {
    const uniquePaths = [...new Set(paths.map((path) => path.trim()).filter(Boolean))]
    if (uniquePaths.length === 0) return
    try {
      const added = await knowledgeApi.addSources(uniquePaths)
      setSources((current) => mergeSources(current, added))
      if (added[0]) setSelectedSourceId(added[0].id)
      void loadSources(true)
    } catch (error) {
      notifyError(error, t('knowledgeSpace.errors.add'))
    }
  }, [loadSources, notifyError, t])

  const chooseSources = useCallback(async (directory: boolean) => {
    try {
      if (isTauriRuntime()) {
        const { open } = await import('@tauri-apps/plugin-dialog')
        const selected = await open({
          directory,
          multiple: !directory,
          title: directory
            ? t('knowledgeSpace.sources.addFolder')
            : t('knowledgeSpace.sources.addFile'),
        })
        const paths = Array.isArray(selected) ? selected : selected ? [selected] : []
        await addSourcePaths(paths)
        return
      }
      const selected = window.prompt(
        directory ? t('knowledgeSpace.sources.folderPrompt') : t('knowledgeSpace.sources.filePrompt'),
      )
      if (selected?.trim()) await addSourcePaths([selected])
    } catch (error) {
      notifyError(error, t('knowledgeSpace.errors.add'))
    }
  }, [addSourcePaths, notifyError, t])

  useEffect(() => {
    if (!isTauriRuntime()) return
    let cancelled = false
    let unlisten: (() => void) | undefined
    void import('@tauri-apps/api/window')
      .then(async ({ getCurrentWindow }) => {
        unlisten = await getCurrentWindow().onDragDropEvent((event) => {
          if (event.payload.type === 'enter' || event.payload.type === 'over') {
            setDragging(true)
          } else if (event.payload.type === 'drop') {
            setDragging(false)
            void addSourcePaths(event.payload.paths)
          } else {
            setDragging(false)
          }
        })
        if (cancelled) unlisten()
      })
      .catch(() => setDragging(false))
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [addSourcePaths])

  const removeSelectedSource = async () => {
    if (!selectedSource) return
    if (!window.confirm(t('knowledgeSpace.details.removeConfirm', { name: selectedSource.name }))) return
    setSourceActionId(selectedSource.id)
    try {
      await knowledgeApi.removeSource(selectedSource.id)
      setSelectedSourceId(null)
      await loadSources(true)
    } catch (error) {
      notifyError(error, t('knowledgeSpace.errors.remove'))
    } finally {
      setSourceActionId(null)
    }
  }

  const reindexSelectedSource = async () => {
    if (!selectedSource) return
    setSourceActionId(selectedSource.id)
    try {
      const nextSource = await knowledgeApi.reindexSource(selectedSource.id)
      setSources((current) => mergeSources(current, [nextSource]))
      void loadSources(true)
    } catch (error) {
      notifyError(error, t('knowledgeSpace.errors.reindex'))
    } finally {
      setSourceActionId(null)
    }
  }

  const enableGraph = async () => {
    if (!projectPath || graphActionLoading) return
    setGraphActionLoading(true)
    try {
      setGraphStatus(await tokenOptimizationApi.enable(projectPath))
    } catch (error) {
      notifyError(error, t('knowledgeSpace.errors.graph'))
    } finally {
      setGraphActionLoading(false)
    }
  }

  const rebuildGraph = async () => {
    if (!projectPath || graphActionLoading) return
    setGraphActionLoading(true)
    setGraph(null)
    try {
      setGraphStatus(await tokenOptimizationApi.rebuild(projectPath))
    } catch (error) {
      notifyError(error, t('knowledgeSpace.errors.graph'))
    } finally {
      setGraphActionLoading(false)
    }
  }

  const handleWebDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    const paths = Array.from(event.dataTransfer.files)
      .map((file) => (file as File & { path?: string }).path)
      .filter((path): path is string => Boolean(path))
    void addSourcePaths(paths)
  }

  return (
    <div
      className="relative flex min-h-0 flex-1 overflow-hidden border-t border-[var(--color-border-separator)] bg-[var(--color-background)]"
      onDragEnter={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false)
      }}
      onDrop={handleWebDrop}
    >
      <SourceRail
        sources={sources}
        selectedSourceId={selectedSourceId}
        loading={loadingSources}
        onSelect={setSelectedSourceId}
        onAddFile={() => void chooseSources(false)}
        onAddFolder={() => void chooseSources(true)}
      />

      <main className="flex min-w-0 flex-1 flex-col bg-[var(--color-background)]">
        <WorkspaceToolbar
          mode={mode}
          projectPath={projectPath}
          stats={stats}
          sources={sources}
          selectedSourceId={selectedSourceId}
          sourceBusy={sourceActionId === selectedSource?.id}
          onModeChange={setMode}
          onSourceChange={setSelectedSourceId}
          onAddFile={() => void chooseSources(false)}
          onAddFolder={() => void chooseSources(true)}
          onReindex={() => void reindexSelectedSource()}
          onRemove={() => void removeSelectedSource()}
        />
        <div className={`min-h-0 flex-1 px-[16px] pb-[16px] pt-[14px] md:px-[20px] ${mode === 'graph' ? 'flex flex-col overflow-hidden' : 'overflow-auto'}`}>
          {mode === 'graph' && (
            <GraphWorkspace
              projectPath={projectPath}
              status={graphStatus}
              graph={graph}
              loading={graphLoading || graphActionLoading}
              onEnable={enableGraph}
              onRebuild={rebuildGraph}
            />
          )}
          {mode === 'files' && (
            <FilesWorkspace documents={documents} loading={loadingSources} />
          )}
          {mode === 'search' && (
            <SearchWorkspace
              query={searchQuery}
              results={searchResults}
              searching={searching}
              onQueryChange={setSearchQuery}
            />
          )}
        </div>
      </main>

      <SourceInspector
        source={selectedSource}
        stats={stats}
        busy={sourceActionId === selectedSource?.id}
        onReindex={() => void reindexSelectedSource()}
        onRemove={() => void removeSelectedSource()}
      />

      {dragging && (
        <div className="pointer-events-none absolute inset-[8px] z-20 flex items-center justify-center rounded-[8px] border border-dashed border-[var(--color-accent)] bg-[var(--color-background)]/90 backdrop-blur-sm">
          <div className="flex items-center gap-[10px] text-[13px] font-medium text-[var(--color-text-primary)]">
            <FolderPlus size={18} />
            {t('knowledgeSpace.sources.drop')}
          </div>
        </div>
      )}
    </div>
  )
}

function SourceRail({
  sources,
  selectedSourceId,
  loading,
  onSelect,
  onAddFile,
  onAddFolder,
}: {
  sources: KnowledgeSource[]
  selectedSourceId: string | null
  loading: boolean
  onSelect: (sourceId: string | null) => void
  onAddFile: () => void
  onAddFolder: () => void
}) {
  const t = useTranslation()
  return (
    <aside className="hidden w-[218px] shrink-0 flex-col border-r border-[var(--color-border-separator)] bg-[var(--color-surface-sidebar)] md:flex">
      <div className="flex h-[52px] items-center justify-between px-[14px]">
        <span className="text-[11px] font-semibold uppercase text-[var(--color-text-tertiary)]">
          {t('knowledgeSpace.sources.title')}
        </span>
        <div className="flex items-center gap-[2px]">
          <IconButton label={t('knowledgeSpace.sources.addFile')} onClick={onAddFile}>
            <FilePlus2 size={15} />
          </IconButton>
          <IconButton label={t('knowledgeSpace.sources.addFolder')} onClick={onAddFolder}>
            <FolderPlus size={15} />
          </IconButton>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-[8px] pb-[12px]">
        <SourceButton
          active={selectedSourceId === null}
          icon={<BookOpen size={15} />}
          label={t('knowledgeSpace.sources.all')}
          meta={String(sources.length)}
          onClick={() => onSelect(null)}
        />
        <div className="my-[8px] h-px bg-[var(--color-border-separator)]" />
        {loading && sources.length === 0 ? (
          <div className="flex h-[72px] items-center justify-center text-[var(--color-text-tertiary)]">
            <LoaderCircle className="animate-spin" size={16} />
          </div>
        ) : sources.length === 0 ? (
          <div className="px-[9px] py-[14px] text-[11px] leading-[18px] text-[var(--color-text-tertiary)]">
            {t('knowledgeSpace.sources.empty')}
          </div>
        ) : sources.map((source) => (
          <SourceButton
            key={source.id}
            active={selectedSourceId === source.id}
            icon={source.kind === 'folder' ? <Folder size={15} /> : <File size={15} />}
            label={source.name}
            meta={source.status === 'indexing' || source.status === 'pending'
              ? t('knowledgeSpace.status.indexing')
              : String(source.documentCount)}
            status={source.status}
            onClick={() => onSelect(source.id)}
          />
        ))}
      </div>
    </aside>
  )
}

function SourceButton({ active, icon, label, meta, status, onClick }: {
  active: boolean
  icon: ReactNode
  label: string
  meta: string
  status?: KnowledgeSource['status']
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mb-[2px] flex h-[36px] w-full min-w-0 items-center gap-[8px] rounded-[6px] px-[9px] text-left transition-colors ${active
        ? 'bg-[var(--color-surface-active)] text-[var(--color-text-primary)]'
        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'}`}
    >
      <span className="shrink-0">{status === 'indexing' || status === 'pending'
        ? <LoaderCircle className="animate-spin" size={15} />
        : icon}</span>
      <span className="min-w-0 flex-1 truncate text-[12px]">{label}</span>
      <span className={`shrink-0 text-[9px] ${status === 'error' ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-tertiary)]'}`}>
        {meta}
      </span>
    </button>
  )
}

function WorkspaceToolbar({
  mode,
  projectPath,
  stats,
  sources,
  selectedSourceId,
  sourceBusy,
  onModeChange,
  onSourceChange,
  onAddFile,
  onAddFolder,
  onReindex,
  onRemove,
}: {
  mode: WorkspaceMode
  projectPath: string | null
  stats: KnowledgeStats
  sources: KnowledgeSource[]
  selectedSourceId: string | null
  sourceBusy: boolean
  onModeChange: (mode: WorkspaceMode) => void
  onSourceChange: (sourceId: string | null) => void
  onAddFile: () => void
  onAddFolder: () => void
  onReindex: () => void
  onRemove: () => void
}) {
  const t = useTranslation()
  return (
    <header className="flex min-h-[64px] shrink-0 flex-wrap items-center gap-[12px] border-b border-[var(--color-border-separator)] px-[16px] py-[10px] md:px-[20px]">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[15px] font-semibold text-[var(--color-text-primary)]">
          {t('knowledgeSpace.title')}
        </h1>
        <p className="mt-[2px] truncate text-[10px] text-[var(--color-text-tertiary)]">
          {projectPath || t('knowledgeSpace.noProject')}
        </p>
      </div>
      <div className="hidden items-center gap-[12px] text-[10px] text-[var(--color-text-tertiary)] xl:flex">
        <CompactStat value={stats.documentCount} label={t('knowledgeSpace.stats.documents')} />
        <CompactStat value={stats.chunkCount} label={t('knowledgeSpace.stats.chunks')} />
        <CompactStat value={formatBytes(stats.sizeBytes)} label={t('knowledgeSpace.stats.size')} />
      </div>
      <div className="flex h-[36px] items-center rounded-[7px] border border-[var(--color-border)] bg-[var(--color-background)] p-[2px]">
        <ModeButton active={mode === 'graph'} label={t('knowledgeSpace.tabs.graph')} onClick={() => onModeChange('graph')}>
          <Network size={14} />
        </ModeButton>
        <ModeButton active={mode === 'files'} label={t('knowledgeSpace.tabs.files')} onClick={() => onModeChange('files')}>
          <Files size={14} />
        </ModeButton>
        <ModeButton active={mode === 'search'} label={t('knowledgeSpace.tabs.search')} onClick={() => onModeChange('search')}>
          <Search size={14} />
        </ModeButton>
      </div>
      {selectedSourceId && (
        <div className="hidden items-center gap-[2px] xl:hidden md:flex">
          <IconButton label={t('knowledgeSpace.details.reindex')} onClick={onReindex} disabled={sourceBusy}>
            <RefreshCw className={sourceBusy ? 'animate-spin' : ''} size={15} />
          </IconButton>
          <IconButton label={t('knowledgeSpace.details.remove')} onClick={onRemove} disabled={sourceBusy} danger>
            <Trash2 size={15} />
          </IconButton>
        </div>
      )}
      <div className="flex w-full min-w-0 items-center gap-[6px] md:hidden">
        <select
          value={selectedSourceId ?? ''}
          onChange={(event) => onSourceChange(event.target.value || null)}
          aria-label={t('knowledgeSpace.sources.title')}
          className="h-[32px] min-w-0 flex-1 rounded-[6px] border border-[var(--color-border)] bg-[var(--color-background)] px-[8px] text-[10px] text-[var(--color-text-secondary)] outline-none"
        >
          <option value="">{t('knowledgeSpace.sources.all')}</option>
          {sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
        </select>
        <IconButton label={t('knowledgeSpace.sources.addFile')} onClick={onAddFile} bordered>
          <FilePlus2 size={15} />
        </IconButton>
        <IconButton label={t('knowledgeSpace.sources.addFolder')} onClick={onAddFolder} bordered>
          <FolderPlus size={15} />
        </IconButton>
        {selectedSourceId && (
          <>
            <IconButton label={t('knowledgeSpace.details.reindex')} onClick={onReindex} disabled={sourceBusy} bordered>
              <RefreshCw className={sourceBusy ? 'animate-spin' : ''} size={15} />
            </IconButton>
            <IconButton label={t('knowledgeSpace.details.remove')} onClick={onRemove} disabled={sourceBusy} bordered danger>
              <Trash2 size={15} />
            </IconButton>
          </>
        )}
      </div>
    </header>
  )
}

function GraphWorkspace({ projectPath, status, graph, loading, onEnable, onRebuild }: {
  projectPath: string | null
  status: CodeGraphStatus | null
  graph: CodeGraphData | null
  loading: boolean
  onEnable: () => void
  onRebuild: () => void
}) {
  const t = useTranslation()
  if (!projectPath) {
    return <WorkspaceEmpty icon={<Network size={22} />} title={t('knowledgeSpace.graph.noProject')} />
  }
  if (!status) {
    return <WorkspaceEmpty icon={<LoaderCircle className="animate-spin" size={20} />} title={t('knowledgeSpace.graph.loading')} />
  }
  if (!status.indexable) {
    return <WorkspaceEmpty icon={<AlertCircle size={20} />} title={t('knowledgeSpace.graph.unavailable')} />
  }
  if (!status.enabled || status.state === 'disabled') {
    return (
      <WorkspaceEmpty
        icon={<Network size={22} />}
        title={t('knowledgeSpace.graph.disabled')}
        action={(
          <ActionButton loading={loading} onClick={onEnable}>
            {t('knowledgeSpace.graph.enable')}
          </ActionButton>
        )}
      />
    )
  }
  if (status.state === 'preparing' || status.state === 'indexing') {
    const current = status.progress?.current ?? 0
    const total = Math.max(status.progress?.total ?? 0, 1)
    return (
      <WorkspaceEmpty
        icon={<LoaderCircle className="animate-spin" size={20} />}
        title={t('knowledgeSpace.graph.preparing')}
        detail={status.progress?.currentFile}
        progress={Math.min(100, Math.round(current / total * 100))}
      />
    )
  }
  if (status.state === 'error') {
    return (
      <WorkspaceEmpty
        icon={<AlertCircle size={20} />}
        title={status.error || t('knowledgeSpace.graph.failed')}
        action={<ActionButton loading={loading} onClick={onRebuild}>{t('knowledgeSpace.graph.rebuild')}</ActionButton>}
      />
    )
  }
  if (status.state === 'empty') {
    return (
      <WorkspaceEmpty
        icon={<Network size={22} />}
        title={t('knowledgeSpace.graph.empty')}
        action={<ActionButton loading={loading} onClick={onRebuild}>{t('knowledgeSpace.graph.rebuild')}</ActionButton>}
      />
    )
  }
  if (loading || !graph) {
    return <WorkspaceEmpty icon={<LoaderCircle className="animate-spin" size={20} />} title={t('knowledgeSpace.graph.loading')} />
  }
  return <CodeGraphVisualization data={graph} />
}

function FilesWorkspace({ documents, loading }: { documents: KnowledgeDocument[]; loading: boolean }) {
  const t = useTranslation()
  if (loading && documents.length === 0) {
    return <WorkspaceEmpty icon={<LoaderCircle className="animate-spin" size={20} />} title={t('knowledgeSpace.files.loading')} />
  }
  if (documents.length === 0) {
    return <WorkspaceEmpty icon={<Files size={21} />} title={t('knowledgeSpace.files.empty')} />
  }
  return (
    <div className="min-w-[560px]">
      <div className="grid h-[32px] grid-cols-[minmax(220px,1fr)_90px_100px] items-center border-b border-[var(--color-border-separator)] px-[10px] text-[9px] font-semibold uppercase text-[var(--color-text-tertiary)]">
        <span>{t('knowledgeSpace.files.name')}</span>
        <span>{t('knowledgeSpace.files.mode')}</span>
        <span className="text-right">{t('knowledgeSpace.files.size')}</span>
      </div>
      {documents.map((document) => (
        <div key={document.id} className="grid min-h-[42px] grid-cols-[minmax(220px,1fr)_90px_100px] items-center border-b border-[var(--color-border-separator)] px-[10px] text-[11px] hover:bg-[var(--color-surface-hover)]">
          <div className="flex min-w-0 items-center gap-[8px]">
            <File size={14} className="shrink-0 text-[var(--color-text-tertiary)]" />
            <div className="min-w-0">
              <div className="truncate text-[var(--color-text-primary)]">{document.title}</div>
              <div className="truncate text-[9px] text-[var(--color-text-tertiary)]">{document.relativePath}</div>
            </div>
          </div>
          <span className="text-[10px] text-[var(--color-text-secondary)]">
            {document.indexMode === 'text' ? t('knowledgeSpace.files.text') : t('knowledgeSpace.files.metadata')}
          </span>
          <span className="text-right text-[10px] text-[var(--color-text-tertiary)]">{formatBytes(document.sizeBytes)}</span>
        </div>
      ))}
    </div>
  )
}

function SearchWorkspace({ query, results, searching, onQueryChange }: {
  query: string
  results: KnowledgeSearchResult[]
  searching: boolean
  onQueryChange: (query: string) => void
}) {
  const t = useTranslation()
  return (
    <div className="mx-auto flex w-full max-w-[820px] flex-col gap-[14px]">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-[12px] top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" size={16} />
        <input
          autoFocus
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t('knowledgeSpace.search.placeholder')}
          aria-label={t('knowledgeSpace.search.placeholder')}
          className="h-[42px] w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-background)] pl-[38px] pr-[38px] text-[13px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)] focus:shadow-[var(--shadow-focus-ring)]"
        />
        {searching && <LoaderCircle className="absolute right-[12px] top-1/2 -translate-y-1/2 animate-spin text-[var(--color-text-tertiary)]" size={15} />}
      </label>
      {!query.trim() ? (
        <WorkspaceEmpty icon={<Search size={21} />} title={t('knowledgeSpace.search.start')} />
      ) : !searching && results.length === 0 ? (
        <WorkspaceEmpty icon={<Search size={21} />} title={t('knowledgeSpace.search.empty')} />
      ) : (
        <div className="divide-y divide-[var(--color-border-separator)] border-y border-[var(--color-border-separator)]">
          {results.map((result) => (
            <article key={`${result.chunkId}-${result.documentId}`} className="px-[10px] py-[13px]">
              <div className="flex min-w-0 items-baseline gap-[8px]">
                <h2 className="truncate text-[12px] font-semibold text-[var(--color-text-primary)]">{result.title}</h2>
                <span className="shrink-0 text-[9px] text-[var(--color-text-tertiary)]">{result.sourceName}</span>
              </div>
              <p className="mt-[6px] line-clamp-3 text-[11px] leading-[18px] text-[var(--color-text-secondary)]">
                <HighlightedExcerpt value={result.excerpt} />
              </p>
              <p className="mt-[6px] truncate text-[9px] text-[var(--color-text-tertiary)]">{result.path}</p>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function SourceInspector({ source, stats, busy, onReindex, onRemove }: {
  source: KnowledgeSource | null
  stats: KnowledgeStats
  busy: boolean
  onReindex: () => void
  onRemove: () => void
}) {
  const t = useTranslation()
  return (
    <aside className="hidden w-[238px] shrink-0 flex-col border-l border-[var(--color-border-separator)] bg-[var(--color-background)] xl:flex">
      <div className="flex h-[52px] items-center px-[16px] text-[11px] font-semibold uppercase text-[var(--color-text-tertiary)]">
        {t('knowledgeSpace.details.title')}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-[16px] pb-[18px]">
        {source ? (
          <>
            <div className="flex items-center gap-[9px] border-b border-[var(--color-border-separator)] pb-[14px]">
              {source.kind === 'folder' ? <Folder size={17} /> : <File size={17} />}
              <div className="min-w-0">
                <div className="truncate text-[12px] font-medium text-[var(--color-text-primary)]">{source.name}</div>
                <div className="mt-[2px] text-[9px] text-[var(--color-text-tertiary)]">{t(`knowledgeSpace.status.${source.status}` as never)}</div>
              </div>
            </div>
            <DetailRow label={t('knowledgeSpace.details.documents')} value={source.documentCount} />
            <DetailRow label={t('knowledgeSpace.details.chunks')} value={source.chunkCount} />
            <DetailRow label={t('knowledgeSpace.details.size')} value={formatBytes(source.sizeBytes)} />
            <DetailRow label={t('knowledgeSpace.details.path')} value={source.path} wrap />
            {source.error && (
              <p className="mt-[12px] text-[10px] leading-[16px] text-[var(--color-danger)]">{source.error}</p>
            )}
            <div className="mt-[18px] flex gap-[8px]">
              <IconButton label={t('knowledgeSpace.details.reindex')} onClick={onReindex} disabled={busy} bordered>
                <RefreshCw className={busy ? 'animate-spin' : ''} size={15} />
              </IconButton>
              <IconButton label={t('knowledgeSpace.details.remove')} onClick={onRemove} disabled={busy} bordered danger>
                <Trash2 size={15} />
              </IconButton>
            </div>
          </>
        ) : (
          <>
            <div className="mb-[14px] flex items-center gap-[9px] border-b border-[var(--color-border-separator)] pb-[14px]">
              <Database size={17} />
              <span className="text-[12px] font-medium text-[var(--color-text-primary)]">{t('knowledgeSpace.sources.all')}</span>
            </div>
            <DetailRow label={t('knowledgeSpace.stats.sources')} value={stats.sourceCount} />
            <DetailRow label={t('knowledgeSpace.stats.documents')} value={stats.documentCount} />
            <DetailRow label={t('knowledgeSpace.stats.chunks')} value={stats.chunkCount} />
            <DetailRow label={t('knowledgeSpace.stats.size')} value={formatBytes(stats.sizeBytes)} />
          </>
        )}
      </div>
    </aside>
  )
}

function WorkspaceEmpty({ icon, title, detail, action, progress }: {
  icon: ReactNode
  title: string
  detail?: string
  action?: ReactNode
  progress?: number
}) {
  return (
    <div className="flex min-h-[360px] flex-1 items-center justify-center">
      <div className="flex max-w-[420px] flex-col items-center text-center">
        <span className="mb-[12px] text-[var(--color-text-tertiary)]">{icon}</span>
        <p className="text-[12px] font-medium text-[var(--color-text-secondary)]">{title}</p>
        {detail && <p className="mt-[5px] max-w-full truncate text-[9px] text-[var(--color-text-tertiary)]">{detail}</p>}
        {progress !== undefined && (
          <div className="mt-[12px] h-[3px] w-[180px] overflow-hidden rounded-full bg-[var(--color-surface-hover)]">
            <div className="h-full bg-[var(--color-accent)] transition-[width] duration-300" style={{ width: `${progress}%` }} />
          </div>
        )}
        {action && <div className="mt-[15px]">{action}</div>}
      </div>
    </div>
  )
}

function ActionButton({ children, loading, onClick }: { children: ReactNode; loading: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={loading}
      onClick={onClick}
      className="flex h-[34px] items-center gap-[7px] rounded-[7px] bg-[var(--color-accent)] px-[13px] text-[11px] font-semibold text-white transition-opacity disabled:opacity-60"
    >
      {loading && <LoaderCircle className="animate-spin" size={14} />}
      {children}
    </button>
  )
}

function ModeButton({ active, label, children, onClick }: {
  active: boolean
  label: string
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={`flex h-[30px] items-center gap-[6px] rounded-[5px] px-[9px] text-[10px] font-medium transition-colors ${active
        ? 'bg-[var(--color-surface-active)] text-[var(--color-text-primary)]'
        : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]'}`}
    >
      {children}
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

function IconButton({ label, children, onClick, disabled = false, bordered = false, danger = false }: {
  label: string
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  bordered?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-[30px] w-[30px] items-center justify-center rounded-[6px] transition-colors disabled:opacity-50 ${bordered ? 'border border-[var(--color-border)]' : ''} ${danger
        ? 'text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10'
        : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'}`}
    >
      {children}
    </button>
  )
}

function CompactStat({ value, label }: { value: string | number; label: string }) {
  return <span><strong className="mr-[4px] font-semibold text-[var(--color-text-secondary)]">{value}</strong>{label}</span>
}

function DetailRow({ label, value, wrap = false }: { label: string; value: string | number; wrap?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-[12px] border-b border-[var(--color-border-separator)] py-[10px] text-[10px]">
      <span className="shrink-0 text-[var(--color-text-tertiary)]">{label}</span>
      <span className={`${wrap ? 'break-all text-right leading-[15px]' : ''} text-[var(--color-text-secondary)]`}>{value}</span>
    </div>
  )
}

function HighlightedExcerpt({ value }: { value: string }) {
  const parts = value.split(/(<mark>|<\/mark>)/i)
  let highlighted = false
  return parts.map((part, index) => {
    if (part.toLowerCase() === '<mark>') {
      highlighted = true
      return null
    }
    if (part.toLowerCase() === '</mark>') {
      highlighted = false
      return null
    }
    return highlighted ? <mark key={index}>{part}</mark> : <span key={index}>{part}</span>
  })
}

function mergeSources(current: KnowledgeSource[], incoming: KnowledgeSource[]): KnowledgeSource[] {
  const byId = new Map(current.map((source) => [source.id, source]))
  incoming.forEach((source) => byId.set(source.id, source))
  return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
