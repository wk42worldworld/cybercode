import {
  ArrowLeft,
  Gauge,
  MessageSquareText,
  Minimize2,
  Network,
  RefreshCw,
  Sparkles,
  Terminal,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import {
  tokenOptimizationApi,
  type CavemanStatus,
  type CodeGraphData,
  type CodeGraphState,
  type CodeGraphStatus,
  type LiteOptimizationStatus,
  type PonytailStatus,
  type RtkStatus,
} from '../api/tokenOptimization'
import { CodeGraphVisualization } from '../components/codegraph/CodeGraphVisualization'
import {
  SettingsPage,
  Switch,
} from '../components/settings/SettingsLayout'
import { useTranslation } from '../i18n'
import { formatBytes } from '../lib/formatBytes'
import { useSessionStore } from '../stores/sessionStore'
import { useTabStore } from '../stores/tabStore'

const POLL_INTERVAL_MS = 800

export function TokenOptimization() {
  const t = useTranslation()
  const activeTabId = useTabStore((state) => state.activeTabId)
  const tabs = useTabStore((state) => state.tabs)
  const sessions = useSessionStore((state) => state.sessions)
  const [status, setStatus] = useState<CodeGraphStatus | null>(null)
  const [graph, setGraph] = useState<CodeGraphData | null>(null)
  const [showGraph, setShowGraph] = useState(false)
  const [loading, setLoading] = useState(false)
  const [graphLoading, setGraphLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rtkStatus, setRtkStatus] = useState<RtkStatus | null>(null)
  const [rtkLoading, setRtkLoading] = useState(false)
  const [rtkError, setRtkError] = useState<string | null>(null)
  const [cavemanStatus, setCavemanStatus] = useState<CavemanStatus | null>(null)
  const [cavemanLoading, setCavemanLoading] = useState(false)
  const [cavemanError, setCavemanError] = useState<string | null>(null)
  const [liteStatus, setLiteStatus] = useState<LiteOptimizationStatus | null>(null)
  const [liteLoading, setLiteLoading] = useState(false)
  const [liteError, setLiteError] = useState<string | null>(null)
  const [ponytailStatus, setPonytailStatus] = useState<PonytailStatus | null>(null)
  const [ponytailLoading, setPonytailLoading] = useState(false)
  const [ponytailError, setPonytailError] = useState<string | null>(null)

  const projectPath = useMemo(() => {
    const activeTab = tabs.find((tab) => tab.sessionId === activeTabId)
    if (!activeTab || activeTab.type !== 'session') return null
    const session = sessions.find((candidate) =>
      candidate.id === activeTab.sessionId
      && (!activeTab.projectPath || candidate.projectPath === activeTab.projectPath),
    )
    return session?.isTemporary ? null : session?.workDir || null
  }, [activeTabId, sessions, tabs])

  const loadStatus = useCallback(async (quiet = false) => {
    if (!projectPath) {
      setStatus(null)
      return
    }
    if (!quiet) setError(null)
    try {
      const nextStatus = await tokenOptimizationApi.status(projectPath)
      setStatus(nextStatus)
    } catch (loadError) {
      if (!quiet) setError(getErrorMessage(loadError, t('tokenOptimization.loadFailed')))
    }
  }, [projectPath, t])

  useEffect(() => {
    let active = true
    void tokenOptimizationApi.rtkStatus()
      .then((nextStatus) => {
        if (active) setRtkStatus(nextStatus)
      })
      .catch((loadError) => {
        if (active) setRtkError(getErrorMessage(loadError, t('tokenOptimization.rtk.loadFailed')))
      })
    return () => {
      active = false
    }
  }, [t])

  useEffect(() => {
    let active = true
    void tokenOptimizationApi.liteStatus()
      .then((nextStatus) => {
        if (active) setLiteStatus(nextStatus)
      })
      .catch((loadError) => {
        if (active) setLiteError(getErrorMessage(loadError, t('tokenOptimization.lite.loadFailed')))
      })
    return () => {
      active = false
    }
  }, [t])

  useEffect(() => {
    let active = true
    void tokenOptimizationApi.ponytailStatus()
      .then((nextStatus) => {
        if (active) setPonytailStatus(nextStatus)
      })
      .catch((loadError) => {
        if (active) setPonytailError(getErrorMessage(loadError, t('tokenOptimization.ponytail.loadFailed')))
      })
    return () => {
      active = false
    }
  }, [t])

  useEffect(() => {
    let active = true
    void tokenOptimizationApi.cavemanStatus()
      .then((nextStatus) => {
        if (active) setCavemanStatus(nextStatus)
      })
      .catch((loadError) => {
        if (active) setCavemanError(getErrorMessage(loadError, t('tokenOptimization.caveman.loadFailed')))
      })
    return () => {
      active = false
    }
  }, [t])

  useEffect(() => {
    setGraph(null)
    setShowGraph(false)
    setStatus(null)
    void loadStatus()
  }, [loadStatus])

  useEffect(() => {
    if (
      status?.state !== 'preparing'
      && status?.state !== 'indexing'
      && status?.state !== 'empty'
    ) return
    const interval = status.state === 'empty' ? 2_000 : POLL_INTERVAL_MS
    const timer = window.setInterval(() => void loadStatus(true), interval)
    return () => window.clearInterval(timer)
  }, [loadStatus, status?.state])

  const toggleCodeGraph = async (enabled: boolean) => {
    if (!projectPath || loading) return
    setLoading(true)
    setError(null)
    try {
      const nextStatus = enabled
        ? await tokenOptimizationApi.enable(projectPath)
        : await tokenOptimizationApi.disable(projectPath)
      setStatus(nextStatus)
      if (!enabled) {
        setGraph(null)
        setShowGraph(false)
      }
    } catch (toggleError) {
      setError(getErrorMessage(toggleError, t('tokenOptimization.updateFailed')))
    } finally {
      setLoading(false)
    }
  }

  const rebuild = async () => {
    if (!projectPath || loading) return
    setLoading(true)
    setError(null)
    try {
      const nextStatus = await tokenOptimizationApi.rebuild(projectPath)
      setStatus(nextStatus)
      setGraph(null)
      setShowGraph(false)
    } catch (rebuildError) {
      setError(getErrorMessage(rebuildError, t('tokenOptimization.rebuildFailed')))
    } finally {
      setLoading(false)
    }
  }

  const openGraph = async () => {
    if (!projectPath || graphLoading) return
    setGraphLoading(true)
    setError(null)
    try {
      const data = await tokenOptimizationApi.graph(projectPath)
      setGraph(data)
      setShowGraph(true)
    } catch (graphError) {
      setError(getErrorMessage(graphError, t('tokenOptimization.graph.loadFailed')))
    } finally {
      setGraphLoading(false)
    }
  }

  const toggleRtk = async (enabled: boolean) => {
    if (rtkLoading) return
    setRtkLoading(true)
    setRtkError(null)
    try {
      const nextStatus = enabled
        ? await tokenOptimizationApi.enableRtk()
        : await tokenOptimizationApi.disableRtk()
      setRtkStatus(nextStatus)
    } catch (toggleError) {
      setRtkError(getErrorMessage(toggleError, t('tokenOptimization.rtk.updateFailed')))
    } finally {
      setRtkLoading(false)
    }
  }

  const toggleCaveman = async (enabled: boolean) => {
    if (cavemanLoading) return
    setCavemanLoading(true)
    setCavemanError(null)
    try {
      const nextStatus = enabled
        ? await tokenOptimizationApi.enableCaveman()
        : await tokenOptimizationApi.disableCaveman()
      setCavemanStatus(nextStatus)
    } catch (toggleError) {
      setCavemanError(getErrorMessage(toggleError, t('tokenOptimization.caveman.updateFailed')))
    } finally {
      setCavemanLoading(false)
    }
  }

  const toggleLite = async (enabled: boolean) => {
    if (liteLoading) return
    setLiteLoading(true)
    setLiteError(null)
    try {
      const nextStatus = enabled
        ? await tokenOptimizationApi.enableLite()
        : await tokenOptimizationApi.disableLite()
      setLiteStatus(nextStatus)
    } catch (toggleError) {
      setLiteError(getErrorMessage(toggleError, t('tokenOptimization.lite.updateFailed')))
    } finally {
      setLiteLoading(false)
    }
  }

  const togglePonytail = async (enabled: boolean) => {
    if (ponytailLoading) return
    setPonytailLoading(true)
    setPonytailError(null)
    try {
      const nextStatus = enabled
        ? await tokenOptimizationApi.enablePonytail()
        : await tokenOptimizationApi.disablePonytail()
      setPonytailStatus(nextStatus)
    } catch (toggleError) {
      setPonytailError(getErrorMessage(toggleError, t('tokenOptimization.ponytail.updateFailed')))
    } finally {
      setPonytailLoading(false)
    }
  }

  const optimizerEstimates = getOptimizerEstimates(
    liteStatus,
    ponytailStatus,
    cavemanStatus,
    rtkStatus,
    status,
  )
  const savingsEstimate = getCombinedSavingsEstimate(optimizerEstimates)
  const activeOptimizerCount = [
    liteStatus?.enabled,
    ponytailStatus?.enabled,
    cavemanStatus?.enabled,
    rtkStatus?.enabled,
    status?.enabled,
  ].filter(Boolean).length

  if (showGraph && graph) {
    return (
      <div className="mx-auto flex min-h-[680px] w-full max-w-[1180px] flex-col gap-[16px]">
        <header className="flex items-center justify-between gap-[16px]">
          <div className="flex min-w-0 items-center gap-[10px]">
            <button
              type="button"
              aria-label={t('tokenOptimization.graph.back')}
              title={t('tokenOptimization.graph.back')}
              onClick={() => setShowGraph(false)}
              className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[7px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="min-w-0">
              <h1 className="text-[20px] font-bold text-[var(--color-text-primary)]">
                {t('tokenOptimization.graph.title')}
              </h1>
              <p className="mt-[3px] truncate text-[11px] text-[var(--color-text-tertiary)]">
                {projectPath}
              </p>
            </div>
          </div>
        </header>
        <CodeGraphVisualization data={graph} />
      </div>
    )
  }

  return (
    <SettingsPage
      title={t('tokenOptimization.title')}
      description={t('tokenOptimization.description')}
    >
      <section
        data-testid="savings-overview"
        className="relative overflow-hidden rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container)] px-[18px] py-[18px] sm:px-[22px]"
      >
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px] bg-[linear-gradient(90deg,#22b8cf_0%,#f2c94c_52%,#ef5da8_100%)]" />
        <div className="grid min-w-0 grid-cols-1 items-center gap-[18px] sm:grid-cols-[minmax(0,1fr)_210px]">
          <div className="min-w-0">
            <div className="flex items-center gap-[7px] text-[11px] font-bold uppercase text-[var(--color-text-tertiary)]">
              <Gauge size={14} />
              {t('tokenOptimization.savings.title')}
            </div>
            <div className="mt-[8px] flex flex-wrap items-end gap-x-[12px] gap-y-[5px]">
              <strong className="text-[42px] font-black leading-none text-[var(--color-text-primary)] tabular-nums">
                {savingsEstimate.display}
              </strong>
              <span className="pb-[3px] text-[12px] text-[var(--color-text-secondary)]">
                {savingsEstimate.hasCycleEstimate
                  ? t('tokenOptimization.savings.scenarioRange')
                  : t('tokenOptimization.savings.off')}
              </span>
            </div>
            <div className="mt-[14px] flex items-center gap-[8px] text-[11px] text-[var(--color-text-tertiary)]">
              <span className="font-bold text-[var(--color-text-primary)] tabular-nums">{activeOptimizerCount}/5</span>
              {t('tokenOptimization.savings.active')}
            </div>
          </div>

          <div className="flex items-center justify-center gap-[10px]">
            <SavingsRing
              label={t('tokenOptimization.savings.minimum')}
              value={savingsEstimate.min}
              color="#22b8cf"
            />
            <SavingsRing
              label={t('tokenOptimization.savings.maximum')}
              value={savingsEstimate.max}
              color="#ef5da8"
              delayMs={100}
            />
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container)]">
        <OptimizerRow
          testId="lite-toolbar"
          icon={<Sparkles size={17} />}
          title={t('tokenOptimization.lite.title')}
          description={t('tokenOptimization.lite.description')}
          active={liteStatus?.enabled ?? false}
          status={liteStatus?.enabled
            ? t('tokenOptimization.lite.active')
            : t('tokenOptimization.lite.inactive')}
          estimate={(
            <SavingsEstimateLabel
              estimate={optimizerEstimates.lite}
              scope={t('tokenOptimization.savings.scope.fullCycle')}
              estimatedLabel={t('tokenOptimization.savings.estimatedShort')}
            />
          )}
          control={(
            <Switch
              checked={liteStatus?.enabled ?? false}
              disabled={liteStatus === null || liteLoading}
              onChange={(enabled) => void toggleLite(enabled)}
              ariaLabel={t('tokenOptimization.lite.toggle')}
            />
          )}
        />

        <OptimizerRow
          testId="ponytail-toolbar"
          icon={<Minimize2 size={17} />}
          title={t('tokenOptimization.ponytail.title')}
          description={t('tokenOptimization.ponytail.description')}
          active={ponytailStatus?.enabled ?? false}
          status={ponytailStatus?.enabled
            ? t('tokenOptimization.ponytail.active')
            : t('tokenOptimization.ponytail.inactive')}
          estimate={(
            <SavingsEstimateLabel
              estimate={optimizerEstimates.ponytail}
              scope={t('tokenOptimization.savings.scope.fullCycle')}
              estimatedLabel={t('tokenOptimization.savings.estimatedShort')}
            />
          )}
          control={(
            <Switch
              checked={ponytailStatus?.enabled ?? false}
              disabled={ponytailStatus === null || ponytailLoading}
              onChange={(enabled) => void togglePonytail(enabled)}
              ariaLabel={t('tokenOptimization.ponytail.toggle')}
            />
          )}
        />

        <OptimizerRow
          testId="caveman-toolbar"
          icon={<MessageSquareText size={17} />}
          title={t('tokenOptimization.caveman.title')}
          description={t('tokenOptimization.caveman.description')}
          active={cavemanStatus?.enabled ?? false}
          status={cavemanStatus?.enabled
            ? t('tokenOptimization.caveman.active')
            : t('tokenOptimization.caveman.inactive')}
          estimate={(
            <SavingsEstimateLabel
              estimate={optimizerEstimates.caveman}
              scope={t('tokenOptimization.savings.scope.fullCycle')}
              estimatedLabel={t('tokenOptimization.savings.estimatedShort')}
            />
          )}
          control={(
            <Switch
              checked={cavemanStatus?.enabled ?? false}
              disabled={cavemanStatus === null || cavemanLoading}
              onChange={(enabled) => void toggleCaveman(enabled)}
              ariaLabel={t('tokenOptimization.caveman.toggle')}
            />
          )}
        />

        <OptimizerRow
          testId="rtk-toolbar"
          icon={<Terminal size={17} />}
          title={t('tokenOptimization.rtk.title')}
          description={t('tokenOptimization.rtk.description')}
          active={rtkStatus?.enabled ?? false}
          status={rtkStatus?.available
            ? t('tokenOptimization.rtk.ready')
            : t('tokenOptimization.rtk.preparing')}
          estimate={(
            <SavingsEstimateLabel
              estimate={optimizerEstimates.rtk}
              scope={t('tokenOptimization.savings.scope.fullCycle')}
              estimatedLabel={t('tokenOptimization.savings.estimatedShort')}
            />
          )}
          metrics={rtkStatus?.stats && rtkStatus.stats.totalCommands > 0 ? (
            <div className="grid grid-cols-2 gap-x-[16px] gap-y-[5px] sm:flex sm:items-center sm:gap-[18px]">
              <CompactMetric label={t('tokenOptimization.rtk.commands')} value={rtkStatus.stats.totalCommands} />
              <CompactMetric label={t('tokenOptimization.rtk.saved')} value={formatTokenCount(rtkStatus.stats.totalSaved)} />
            </div>
          ) : undefined}
          meta={rtkStatus?.version ? `v${rtkStatus.version}` : undefined}
          control={(
            <Switch
              checked={rtkStatus?.enabled ?? false}
              disabled={rtkStatus === null || rtkLoading || !rtkStatus.available}
              onChange={(enabled) => void toggleRtk(enabled)}
              ariaLabel={t('tokenOptimization.rtk.toggle')}
            />
          )}
        />

        <OptimizerRow
          testId="codegraph-toolbar"
          icon={<Network size={17} />}
          title={t('tokenOptimization.codeGraph.title')}
          description={!projectPath || status?.indexable === false
            ? t('tokenOptimization.noProject')
            : t('tokenOptimization.codeGraph.description')}
          active={status?.enabled ?? false}
          status={<StatusLabel state={status?.state ?? 'disabled'} />}
          estimate={(
            <SavingsEstimateLabel
              estimate={optimizerEstimates.codeGraph}
              scope={t('tokenOptimization.savings.scope.fullCycle')}
              estimatedLabel={t('tokenOptimization.savings.estimatedShort')}
            />
          )}
          metrics={status?.stats ? (
            <div className="grid grid-cols-2 gap-x-[16px] gap-y-[5px] sm:grid-cols-4 sm:gap-[18px]">
              <CompactMetric label={t('tokenOptimization.stats.files')} value={status.stats.fileCount} />
              <CompactMetric label={t('tokenOptimization.stats.symbols')} value={status.stats.nodeCount} />
              <CompactMetric label={t('tokenOptimization.stats.relations')} value={status.stats.edgeCount} />
              <CompactMetric label={t('tokenOptimization.stats.size')} value={formatBytes(status.stats.dbSizeBytes)} />
            </div>
          ) : status && (status.state === 'preparing' || status.state === 'indexing') ? (
            <span className="text-[11px] text-[var(--color-text-tertiary)]">
              {progressLabel(status, t)}
              {status.progress && status.progress.total > 0
                ? ` ${status.progress.current}/${status.progress.total}`
                : ''}
            </span>
          ) : undefined}
          actions={(
            <div className="flex items-center gap-[3px]">
              <button
                type="button"
                aria-label={t('tokenOptimization.rebuild')}
                title={t('tokenOptimization.rebuild')}
                disabled={!status?.enabled || !['ready', 'empty'].includes(status.state) || loading}
                onClick={() => void rebuild()}
                className="flex h-[32px] w-[32px] items-center justify-center rounded-[7px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-35"
              >
                <RefreshCw size={15} className={loading || status?.state === 'indexing' ? 'animate-spin' : undefined} />
              </button>
              <button
                type="button"
                aria-label={t('tokenOptimization.visualize')}
                title={t('tokenOptimization.visualize')}
                disabled={status?.state !== 'ready' || graphLoading}
                onClick={() => void openGraph()}
                className="flex h-[32px] w-[32px] items-center justify-center rounded-[7px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-35"
              >
                <Network size={16} className={graphLoading ? 'animate-pulse' : undefined} />
              </button>
            </div>
          )}
          control={(
            <Switch
              checked={status?.enabled ?? false}
              disabled={!projectPath || status === null || status.indexable === false || loading}
              onChange={(enabled) => void toggleCodeGraph(enabled)}
              ariaLabel={t('tokenOptimization.codeGraph.toggle')}
            />
          )}
        />
      </section>

      {[liteError, ponytailError, cavemanError, rtkError, error].filter(Boolean).map((message) => (
        <div
          key={message}
          role="alert"
          className="rounded-[8px] border border-[var(--color-error)]/25 bg-[var(--color-error)]/5 px-[14px] py-[11px] text-[12px] text-[var(--color-error)]"
        >
          {message}
        </div>
      ))}
    </SettingsPage>
  )
}

function OptimizerRow({
  testId,
  icon,
  title,
  description,
  active,
  status,
  estimate,
  metrics,
  meta,
  actions,
  control,
}: {
  testId: string
  icon: ReactNode
  title: string
  description: string
  active: boolean
  status: ReactNode
  estimate: ReactNode
  metrics?: ReactNode
  meta?: string
  actions?: ReactNode
  control: ReactNode
}) {
  return (
    <div
      data-testid={testId}
      className="grid min-w-0 grid-cols-[38px_minmax(0,1fr)_auto] gap-x-[11px] gap-y-[10px] border-b border-[var(--color-border-separator)] px-[14px] py-[14px] last:border-b-0 sm:grid-cols-[38px_minmax(180px,1fr)_minmax(180px,auto)_auto] sm:items-center sm:px-[16px]"
    >
      <div className={`flex h-[36px] w-[36px] items-center justify-center rounded-[7px] transition-colors ${
        active
          ? 'bg-[var(--color-text-primary)] text-[var(--color-surface-container)]'
          : 'bg-[var(--color-surface-container-low)] text-[var(--color-text-tertiary)]'
      }`}>
        {icon}
      </div>
      <div className="min-w-0 self-center">
        <div className="flex min-w-0 flex-wrap items-center gap-x-[8px] gap-y-[2px]">
          <h2 className="text-[11px] font-medium leading-[15px] text-[var(--color-text-primary)]">{title}</h2>
          <div className={`flex items-center gap-[5px] text-[10px] font-bold ${
            active ? 'text-[var(--color-success)]' : 'text-[var(--color-text-tertiary)]'
          }`}>
            <span aria-hidden="true" className={`h-[5px] w-[5px] rounded-full ${active ? 'bg-current' : 'bg-[var(--color-border)]'}`} />
            {status}
          </div>
          {estimate}
        </div>
        <p className="mt-[3px] max-w-[460px] text-[10px] leading-[1.45] text-[var(--color-text-tertiary)]">
          {description}
        </p>
      </div>
      <div className="col-span-2 col-start-2 min-w-0 sm:col-span-1 sm:col-start-auto">
        {metrics}
      </div>
      <div className="col-start-3 row-start-1 flex items-center justify-end gap-[7px] self-center sm:col-start-auto sm:row-start-auto">
        {meta && <span className="text-[9px] text-[var(--color-text-tertiary)]">{meta}</span>}
        {actions}
        {control}
      </div>
    </div>
  )
}

function formatTokenCount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}

type OptimizerEstimate = {
  min: number
  max: number
  display: string
  enabled: boolean
}

function getOptimizerEstimates(
  lite: LiteOptimizationStatus | null,
  ponytail: PonytailStatus | null,
  caveman: CavemanStatus | null,
  rtk: RtkStatus | null,
  codeGraph: CodeGraphStatus | null,
) {
  return {
    lite: createEstimate(2, 8, lite?.enabled ?? false),
    // Ponytail's fair agentic benchmark measured up to 22% fewer tokens, but
    // irreducible tasks and some reasoning models can land near zero savings.
    ponytail: createEstimate(0, 22, ponytail?.enabled ?? false),
    caveman: createEstimate(14, 21, caveman?.enabled ?? false),
    // RTK reports 60–90% command-output reduction. At an estimated 30% share
    // of a coding-agent cycle, that contributes roughly 18–27% end to end.
    rtk: createEstimate(18, 27, rtk?.enabled ?? false),
    codeGraph: createEstimate(23, 64, codeGraph?.enabled ?? false),
  }
}

function createEstimate(min: number, max: number, enabled: boolean): OptimizerEstimate {
  return {
    min,
    max,
    enabled,
    display: min === max ? `${min}%` : `${min}–${max}%`,
  }
}

function getCombinedSavingsEstimate(estimates: ReturnType<typeof getOptimizerEstimates>) {
  const enabled = Object.values(estimates).some((estimate) => estimate.enabled)
  if (!enabled) {
    return {
      display: '0%',
      min: 0,
      max: 0,
      enabled: false,
      hasCycleEstimate: false,
    }
  }

  // Compound each optimizer against the remaining token volume. This keeps
  // the estimate below a naive sum while ensuring every enabled switch makes
  // its own visible contribution to the total range.
  const cycleEstimates = Object.values(estimates)
    .filter((estimate) => estimate.enabled)

  const min = combineIndependentPercentages(cycleEstimates.map((estimate) => estimate.min))
  const max = combineIndependentPercentages(cycleEstimates.map((estimate) => estimate.max))
  return {
    display: min === max ? `${min}%` : `${min}–${max}%`,
    min,
    max,
    enabled: true,
    hasCycleEstimate: true,
  }
}

function combineIndependentPercentages(percentages: number[]) {
  const remaining = percentages.reduce(
    (ratio, percentage) => ratio * (1 - percentage / 100),
    1,
  )
  return Math.max(0, Math.min(99, Math.round((1 - remaining) * 100)))
}

function SavingsRing({
  label,
  value,
  color,
  delayMs = 0,
}: {
  label: string
  value: number
  color: string
  delayMs?: number
}) {
  const radius = 38
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - value / 100)

  return (
    <div
      aria-label={`${label} ${value}%`}
      className="relative h-[94px] w-[94px] shrink-0"
    >
      <svg aria-hidden="true" viewBox="0 0 94 94" className="h-full w-full -rotate-90">
        <circle
          cx="47"
          cy="47"
          r={radius}
          fill="none"
          stroke="var(--color-border-separator)"
          strokeWidth="7"
        />
        <circle
          key={`${value}-${color}`}
          cx="47"
          cy="47"
          r={radius}
          fill="none"
          stroke={color}
          strokeLinecap="round"
          strokeWidth="7"
          className="token-savings-ring"
          style={{
            '--ring-circumference': circumference,
            '--ring-offset': offset,
            animationDelay: `${delayMs}ms`,
          } as CSSProperties}
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <strong className="text-[16px] font-black leading-none text-[var(--color-text-primary)] tabular-nums">
          {value}%
        </strong>
        <span className="mt-[4px] text-[9px] font-bold text-[var(--color-text-tertiary)]">
          {label}
        </span>
      </div>
    </div>
  )
}

function SavingsEstimateLabel({
  estimate,
  scope,
  estimatedLabel,
}: {
  estimate: OptimizerEstimate
  scope: string
  estimatedLabel: string
}) {
  return (
    <span className="flex items-baseline gap-[4px] border-l border-[var(--color-border-separator)] pl-[8px] text-[10px]">
      <span className="text-[var(--color-text-tertiary)]">
        {scope} {estimatedLabel}
      </span>
      <strong className="font-black text-[var(--color-text-primary)] tabular-nums">
        {estimate.display}
      </strong>
    </span>
  )
}

function StatusLabel({ state }: { state: CodeGraphState }) {
  const t = useTranslation()
  const tone = state === 'ready'
    ? 'text-[var(--color-success)]'
    : state === 'empty'
      ? 'text-[var(--color-warning)]'
    : state === 'error'
      ? 'text-[var(--color-error)]'
      : 'text-[var(--color-text-tertiary)]'
  return (
    <span className={`shrink-0 whitespace-nowrap text-[11px] font-semibold ${tone}`}>
      {t(`tokenOptimization.state.${state}`)}
    </span>
  )
}

function CompactMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="flex min-w-0 flex-col">
      <strong className="truncate text-[12px] font-bold leading-none text-[var(--color-text-primary)] tabular-nums">{value}</strong>
      <span className="mt-[3px] truncate text-[9px] text-[var(--color-text-tertiary)]">{label}</span>
    </span>
  )
}

function progressLabel(
  status: CodeGraphStatus,
  t: ReturnType<typeof useTranslation>,
) {
  if (status.state === 'preparing') return t('tokenOptimization.state.preparing')
  const phase = status.progress?.phase
  if (phase === 'scanning') return t('tokenOptimization.phase.scanning')
  if (phase === 'parsing') return t('tokenOptimization.phase.parsing')
  if (phase === 'resolving') return t('tokenOptimization.phase.resolving')
  return t('tokenOptimization.state.indexing')
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}
