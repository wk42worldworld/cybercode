import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  computerUseApi,
  type ComputerUseRuntimePhase,
  type ComputerUseStatus,
  type InstalledApp,
  type AuthorizedApp,
} from '../api/computerUse'
import { useTranslation } from '../i18n'
import { SettingsPage } from '../components/settings/SettingsLayout'
import { Button } from '../components/shared/Button'
import { Icon } from '../components/shared/Icon'

type CheckState = 'loading' | 'ready' | 'error'
const ACTIVE_RUNTIME_PHASES = new Set<ComputerUseRuntimePhase>([
  'checking',
  'downloading',
  'verifying',
  'installing',
])

function formatBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return ''
  if (value < 1024 * 1024) return `${Math.max(0, value / 1024).toFixed(0)} KB`
  return `${Math.max(0, value / 1024 / 1024).toFixed(1)} MB`
}

function StatusIcon({ ok }: { ok: boolean | null }) {
  if (ok === null) {
    return <Icon name="help" size={18} className="text-[var(--color-text-tertiary)]" />
  }
  return ok ? (
    <Icon name="check_circle" size={18} className="text-[var(--color-success)]" />
  ) : (
    <Icon name="cancel" size={18} className="text-[var(--color-error)]" />
  )
}

function StatusRow({ label, ok, detail }: { label: string; ok: boolean | null; detail: string }) {
  return (
    <div className="flex items-center gap-3 py-2.5 px-4 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-container)]">
      <StatusIcon ok={ok} />
      <div className="flex-1 min-w-0">
        <span className="text-[14px] font-medium text-[var(--color-text-primary)]">{label}</span>
        <span className="ml-2 break-all text-[12px] text-[var(--color-text-tertiary)]">{detail}</span>
      </div>
    </div>
  )
}

async function openSystemSettings(pane: 'Privacy_ScreenCapture' | 'Privacy_Accessibility') {
  await computerUseApi.openSettings(pane)
}

export function ComputerUseSettings() {
  const t = useTranslation()
  const [status, setStatus] = useState<ComputerUseStatus | null>(null)
  const [checkState, setCheckState] = useState<CheckState>('loading')
  const [runtimeActionError, setRuntimeActionError] = useState<string | null>(null)
  const statusRequest = useRef<Promise<void> | null>(null)

  // App authorization state
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([])
  const [authorizedBundleIds, setAuthorizedBundleIds] = useState<Set<string>>(new Set())
  const [authorizedApps, setAuthorizedApps] = useState<AuthorizedApp[]>([])
  const [appsLoading, setAppsLoading] = useState(false)
  const [appsSaved, setAppsSaved] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [clipboardAccess, setClipboardAccess] = useState(true)
  const [systemKeys, setSystemKeys] = useState(true)

  const fetchStatus = useCallback(async (silent = false, fresh = false): Promise<void> => {
    // Focus, visibility changes and preparation polling can coincide. Share the
    // active check instead of spawning another pair of Python probes.
    if (statusRequest.current) {
      if (!fresh) return statusRequest.current
      // A runtime action needs a check started after the action completed.
      await statusRequest.current
    }
    if (!silent) setCheckState('loading')
    const request = (async () => {
      try {
        const s = await computerUseApi.getStatus()
        setStatus(s)
        setCheckState('ready')
      } catch {
        if (!silent) setCheckState('error')
      }
    })()
    statusRequest.current = request
    void request.finally(() => { statusRequest.current = null })
    return request
  }, [])

  const fetchApps = useCallback(async () => {
    setAppsLoading(true)
    try {
      const [appsResult, configResult] = await Promise.all([
        computerUseApi.getInstalledApps(),
        computerUseApi.getAuthorizedApps(),
      ])
      setInstalledApps(appsResult.apps)
      setAuthorizedApps(configResult.authorizedApps)
      setAuthorizedBundleIds(new Set(configResult.authorizedApps.map(a => a.bundleId)))
      setClipboardAccess(configResult.grantFlags.clipboardRead)
      setSystemKeys(configResult.grantFlags.systemKeyCombos)
    } catch {
      // API not ready
    } finally {
      setAppsLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchStatus()
  }, [fetchStatus])

  useEffect(() => {
    const recheckAfterReturning = () => {
      if (document.visibilityState === 'hidden') return
      void fetchStatus(true)
    }
    window.addEventListener('focus', recheckAfterReturning)
    document.addEventListener('visibilitychange', recheckAfterReturning)
    return () => {
      window.removeEventListener('focus', recheckAfterReturning)
      document.removeEventListener('visibilitychange', recheckAfterReturning)
    }
  }, [fetchStatus])

  // Load apps when environment is ready
  const envReady = status?.runtime.ready ?? false
  useEffect(() => {
    if (envReady) void fetchApps()
  }, [envReady, fetchApps])

  const runtimePhase = status?.runtime.phase
  const runtimeActive = runtimePhase ? ACTIVE_RUNTIME_PHASES.has(runtimePhase) : false
  useEffect(() => {
    if (!runtimeActive) return
    const timer = window.setInterval(() => void fetchStatus(true), 600)
    return () => window.clearInterval(timer)
  }, [runtimeActive, fetchStatus])

  const handleSetup = async () => {
    setRuntimeActionError(null)
    try {
      const runtime = await computerUseApi.prepareRuntime()
      setStatus(current => current ? { ...current, runtime } : current)
      await fetchStatus(true, true)
    } catch (error) {
      setRuntimeActionError(error instanceof Error ? error.message : String(error))
    }
  }

  const handlePause = async () => {
    setRuntimeActionError(null)
    try {
      const runtime = await computerUseApi.pauseRuntime()
      setStatus(current => current ? { ...current, runtime } : current)
      await fetchStatus(true, true)
    } catch (error) {
      setRuntimeActionError(error instanceof Error ? error.message : String(error))
    }
  }

  const toggleApp = (app: InstalledApp) => {
    const newSet = new Set(authorizedBundleIds)
    let newAuthorized = [...authorizedApps]
    if (newSet.has(app.bundleId)) {
      newSet.delete(app.bundleId)
      newAuthorized = newAuthorized.filter(a => a.bundleId !== app.bundleId)
    } else {
      newSet.add(app.bundleId)
      newAuthorized.push({
        bundleId: app.bundleId,
        displayName: app.displayName,
        authorizedAt: new Date().toISOString(),
      })
    }
    setAuthorizedBundleIds(newSet)
    setAuthorizedApps(newAuthorized)

    // Auto-save
    computerUseApi.setAuthorizedApps({
      authorizedApps: newAuthorized,
      grantFlags: { clipboardRead: clipboardAccess, clipboardWrite: clipboardAccess, systemKeyCombos: systemKeys },
    }).then(() => {
      setAppsSaved(true)
      setTimeout(() => setAppsSaved(false), 1500)
    })
  }

  const toggleFlag = (flag: 'clipboard' | 'systemKeys', value: boolean) => {
    if (flag === 'clipboard') setClipboardAccess(value)
    else setSystemKeys(value)

    computerUseApi.setAuthorizedApps({
      authorizedApps,
      grantFlags: {
        clipboardRead: flag === 'clipboard' ? value : clipboardAccess,
        clipboardWrite: flag === 'clipboard' ? value : clipboardAccess,
        systemKeyCombos: flag === 'systemKeys' ? value : systemKeys,
      },
    })
  }

  const allReady =
    status?.supported &&
    status.runtime.ready &&
    (status.platform !== 'linux' || (
      status.permissions.inputAvailable === true &&
      status.permissions.screenRecording === true
    ))

  const accessibilityNeedsAttention = status?.permissions.accessibility === false
  const screenRecordingNeedsAttention = status?.permissions.screenRecording === false
  const screenRecordingReady = status ? status.permissions.screenRecording !== false : null
  const runtimeDetail = status ? (() => {
    const runtime = status.runtime
    switch (runtime.phase) {
      case 'checking':
        return t('settings.computerUse.runtimeChecking')
      case 'downloading': {
        const downloaded = formatBytes(runtime.downloadedBytes)
        const total = formatBytes(runtime.totalBytes)
        return t('settings.computerUse.runtimeDownloading', {
          percent: runtime.progressPercent,
          size: total ? `${downloaded} / ${total}` : downloaded,
        })
      }
      case 'verifying':
        return t('settings.computerUse.runtimeVerifying')
      case 'installing':
        return t('settings.computerUse.runtimeInstalling')
      case 'ready':
        return runtime.source === 'legacy'
          ? t('settings.computerUse.runtimeLegacyReady')
          : runtime.source === 'bundled'
            ? t('settings.computerUse.runtimeBundledReady', { version: runtime.version ?? '' })
            : t('settings.computerUse.runtimeReady', { version: runtime.version ?? '' })
      case 'paused':
        return t('settings.computerUse.runtimePaused')
      case 'error':
        return runtime.error ?? t('settings.computerUse.runtimeError')
      default:
        return t('settings.computerUse.runtimeNotInstalled')
    }
  })() : ''

  // Filter apps by search query
  const filteredApps = useMemo(() => {
    if (!searchQuery) return installedApps
    const q = searchQuery.toLowerCase()
    return installedApps.filter(
      a => a.displayName.toLowerCase().includes(q) || a.bundleId.toLowerCase().includes(q)
    )
  }, [installedApps, searchQuery])

  // Sort: authorized apps first, then alphabetical
  const sortedApps = useMemo(() => {
    return [...filteredApps].sort((a, b) => {
      const aAuth = authorizedBundleIds.has(a.bundleId) ? 0 : 1
      const bAuth = authorizedBundleIds.has(b.bundleId) ? 0 : 1
      if (aAuth !== bAuth) return aAuth - bAuth
      return a.displayName.localeCompare(b.displayName)
    })
  }, [filteredApps, authorizedBundleIds])

  return (
    <SettingsPage icon="mouse" title={t('settings.computerUse.title')} description={t('settings.computerUse.description')}>
      <div className="space-y-5">
        {checkState === 'loading' ? (
        <div className="py-8 text-center text-[14px] text-[var(--color-text-tertiary)]">
          {t('common.loading')}
        </div>
      ) : checkState === 'error' ? (
        <div className="py-8 text-center text-[14px] text-red-400">
          Failed to check status.
          <button onClick={() => void fetchStatus()} className="ml-2 underline">{t('common.retry')}</button>
        </div>
      ) : status ? (
        <>
          {!status.supported && (
            <div className="px-4 py-3 rounded-[12px] bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/40 text-[14px] text-[var(--color-warning)]">
              {t('settings.computerUse.notSupported')}
            </div>
          )}

          {status.supported && !envReady && (
            <section
              aria-labelledby="computer-use-quick-setup-title"
              className="border-y border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-5 py-5"
            >
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-start gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-[8px] bg-[var(--color-brand)] text-[var(--color-on-primary)]">
                      <Icon name="download" size={22} />
                    </div>
                    <div>
                      <h3
                        id="computer-use-quick-setup-title"
                        className="text-[16px] font-semibold text-[var(--color-text-primary)]"
                      >
                        {t('settings.computerUse.quickSetupTitle')}
                      </h3>
                      <p className="mt-1 max-w-[620px] text-[13px] leading-5 text-[var(--color-text-secondary)]">
                        {t('settings.computerUse.quickSetupDescription')}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[12px] text-[var(--color-text-tertiary)]">
                    {[
                      t('settings.computerUse.quickSetupNoPython'),
                      t('settings.computerUse.quickSetupVerified'),
                      t('settings.computerUse.quickSetupResumable'),
                    ].map(item => (
                      <span key={item} className="inline-flex items-center gap-1.5">
                        <Icon name="check" size={14} className="text-[var(--color-success)]" />
                        {item}
                      </span>
                    ))}
                  </div>
                  {!runtimeActive && status.runtime.phase !== 'not-installed' && (
                    <p
                      role={status.runtime.phase === 'error' ? 'alert' : 'status'}
                      className={`mt-3 text-[12px] ${
                        status.runtime.phase === 'error'
                          ? 'text-[var(--color-error)]'
                          : 'text-[var(--color-text-secondary)]'
                      }`}
                    >
                      {runtimeDetail}
                    </p>
                  )}
                </div>

                {!runtimeActive && (
                  <Button
                    type="button"
                    size="lg"
                    onClick={handleSetup}
                    icon={<Icon name="download" size={18} />}
                    className="shrink-0"
                  >
                    {status.runtime.phase === 'error'
                      ? t('settings.computerUse.runtimeRetry')
                      : status.runtime.phase === 'paused'
                        ? t('settings.computerUse.runtimeResume')
                        : t('settings.computerUse.runtimeInstallAll')}
                  </Button>
                )}
              </div>

              {runtimeActive && (
                <div className="mt-5">
                  <div className="flex items-center justify-between gap-4 text-[12px]">
                    <span className="font-medium text-[var(--color-text-primary)]">
                      {runtimeDetail}
                    </span>
                    <span className="tabular-nums text-[var(--color-text-tertiary)]">
                      {status.runtime.progressPercent}%
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-border-separator)]">
                    <div
                      role="progressbar"
                      aria-label={t('settings.computerUse.runtime')}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={status.runtime.progressPercent}
                      className="h-full rounded-full bg-[var(--color-brand)] transition-[width] duration-300 ease-out"
                      style={{ width: `${Math.max(2, status.runtime.progressPercent)}%` }}
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[12px] text-[var(--color-text-tertiary)]">
                      {t('settings.computerUse.runtimeBackgroundHint')}
                    </p>
                    {status.runtime.canPause && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={handlePause}
                        icon={<Icon name="pause" size={16} />}
                      >
                        {t('settings.computerUse.runtimePause')}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Runtime status */}
          {envReady && (
            <StatusRow
              label={t('settings.computerUse.runtime')}
              ok
              detail={runtimeDetail}
            />
          )}

          {/* macOS Permissions — only shown on macOS (darwin) */}
          {envReady && status.platform === 'darwin' && (
            <>
              <StatusRow
                label={t('settings.computerUse.accessibility')}
                ok={status.permissions.accessibility}
                detail={
                  status.permissions.accessibility === null ? t('settings.computerUse.permUnknown')
                    : status.permissions.accessibility ? t('settings.computerUse.permGranted')
                      : t('settings.computerUse.permDenied')
                }
              />
              <StatusRow
                label={t('settings.computerUse.screenRecording')}
                ok={screenRecordingReady}
                detail={
                  status.permissions.screenRecording === true ? t('settings.computerUse.permGranted')
                    : status.permissions.screenRecording === false ? t('settings.computerUse.permDenied')
                      : t('settings.computerUse.permScreenRecordingUnknownSoft')
                }
              />
              {(accessibilityNeedsAttention || screenRecordingNeedsAttention) && (
                <div className="flex flex-col gap-2 px-4 py-3 rounded-[12px] bg-[var(--color-warning)]/5 border border-[var(--color-warning)]/30">
                  <p className="text-[12px] text-[var(--color-text-tertiary)]">{t('settings.computerUse.permRestartHint')}</p>
                  <div className="flex gap-2">
                    {accessibilityNeedsAttention && (
                      <button
                        onClick={() => openSystemSettings('Privacy_Accessibility')}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold text-[var(--color-brand)] border border-[var(--color-border)] rounded-full hover:bg-[var(--color-surface-hover)]"
                      >
                        <Icon name="open_in_new" size={14} />
                        {t('settings.computerUse.openAccessibility')}
                      </button>
                    )}
                    {screenRecordingNeedsAttention && (
                      <button
                        onClick={() => openSystemSettings('Privacy_ScreenCapture')}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold text-[var(--color-brand)] border border-[var(--color-border)] rounded-full hover:bg-[var(--color-surface-hover)]"
                      >
                        <Icon name="open_in_new" size={14} />
                        {t('settings.computerUse.openScreenRecording')}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {envReady && status.platform === 'linux' && (
            <>
              <StatusRow
                label={t('settings.computerUse.screenCapture')}
                ok={status.permissions.screenRecording}
                detail={
                  status.permissions.screenRecording === false
                    ? t('settings.computerUse.linuxCaptureUnavailable')
                    : status.permissions.screenRecording === true
                      ? t('settings.computerUse.linuxCaptureReady')
                      : t('settings.computerUse.permUnknown')
                }
              />
              <StatusRow
                label={t('settings.computerUse.desktopInput')}
                ok={status.permissions.inputAvailable ?? null}
                detail={
                  status.permissions.inputAvailable === false
                    ? t('settings.computerUse.linuxWaylandInputLimited')
                    : status.permissions.inputAvailable === true
                      ? t('settings.computerUse.linuxInputReady')
                      : t('settings.computerUse.permUnknown')
                }
              />
            </>
          )}

          {allReady && (status.platform !== 'darwin' || (status.permissions.accessibility && screenRecordingReady)) && (
            <div className="px-4 py-3 rounded-[12px] bg-[var(--color-success)]/10 border border-[var(--color-brand)]/40 text-[14px] text-[var(--color-success)] flex items-center gap-2">
              <Icon name="verified" size={18} />
              {t('settings.computerUse.allReady')}
            </div>
          )}

          {runtimeActionError && (
            <div className="rounded-[12px] border border-[var(--color-error)]/30 bg-[var(--color-error)]/5 px-4 py-3 text-[12px] text-[var(--color-error)]">
              {runtimeActionError}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => void fetchStatus()}
              icon={<Icon name="refresh" size={18} />}
            >
              {t('settings.computerUse.recheckBtn')}
            </Button>
          </div>

          {/* ─── App Authorization Section ─── */}
          {envReady && (
            <div className="space-y-4 pt-4 border-t border-[var(--color-border-separator)]">
              <div>
                <h3 className="text-[16px] font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
                  {t('settings.computerUse.appsTitle')}
                  {appsSaved && (
                    <span className="text-[12px] font-normal text-[var(--color-success)] flex items-center gap-1">
                      <Icon name="check" size={14} />
                      {t('settings.computerUse.appsSaved')}
                    </span>
                  )}
                </h3>
                <p className="mt-1 text-[14px] text-[var(--color-text-secondary)]">
                  {t('settings.computerUse.appsDescription')}
                </p>
              </div>

              {/* Grant flags */}
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-[14px] text-[var(--color-text-secondary)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={clipboardAccess}
                    onChange={e => toggleFlag('clipboard', e.target.checked)}
                    className="rounded border-[var(--color-border)] accent-[var(--color-brand)]"
                  />
                  {t('settings.computerUse.flagClipboard')}
                </label>
                <label className="flex items-center gap-2 text-[14px] text-[var(--color-text-secondary)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={systemKeys}
                    onChange={e => toggleFlag('systemKeys', e.target.checked)}
                    className="rounded border-[var(--color-border)] accent-[var(--color-brand)]"
                  />
                  {t('settings.computerUse.flagSystemKeys')}
                </label>
              </div>

              {/* Search */}
              <div className="relative">
                <Icon name="search" size={18} className="text-[var(--color-text-tertiary)] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder={t('settings.computerUse.appsSearch')}
                  className="h-[40px] w-full rounded-[10px] border border-[var(--color-border)] bg-white py-2 pl-9 pr-4 text-[13px] font-medium text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-border-focus)] focus:shadow-[var(--shadow-focus-ring)] dark:bg-[var(--color-surface-container-low)]"
                />
              </div>

              {/* App list */}
              {appsLoading ? (
                <div className="py-6 text-center text-[14px] text-[var(--color-text-tertiary)]">
                  {t('settings.computerUse.appsLoading')}
                </div>
              ) : installedApps.length === 0 ? (
                <div className="py-6 text-center text-[14px] text-[var(--color-text-tertiary)]">
                  {t('settings.computerUse.appsEmpty')}
                </div>
              ) : (
                <div className="max-h-[400px] overflow-y-auto rounded-[12px] border border-[var(--color-border)]">
                  {sortedApps.map(app => {
                    const isAuthorized = authorizedBundleIds.has(app.bundleId)
                    return (
                      <button
                        key={app.bundleId}
                        onClick={() => toggleApp(app)}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--color-surface-hover)] border-b border-[var(--color-border)] last:border-b-0 ${
                          isAuthorized ? 'bg-[var(--color-accent-glow)]' : ''
                        }`}
                      >
                        <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border ${
                          isAuthorized
                            ? 'bg-[var(--color-brand)] border-[var(--color-brand)] shadow-[0_0_0_3px_var(--color-accent-glow)]'
                            : 'border-[var(--color-border)]'
                        }`}>
                          {isAuthorized && (
                            <Icon name="check" size={14} className="text-[var(--color-on-primary)]" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[14px] font-medium text-[var(--color-text-primary)] truncate">
                            {app.displayName}
                          </div>
                          <div className="text-[11px] text-[var(--color-text-tertiary)] truncate font-mono">
                            {app.bundleId}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </>
      ) : null}
      </div>
    </SettingsPage>
  )
}
