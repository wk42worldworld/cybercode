import { useEffect } from 'react'
import { useTranslation } from '../../i18n'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { isTauriRuntime } from '../../lib/desktopRuntime'
import { useUpdateStore } from '../../stores/updateStore'
import { formatBytes } from '../../lib/formatBytes'
import { Button } from './Button'

export function UpdateChecker() {
  const t = useTranslation()
  const status = useUpdateStore((s) => s.status)
  const availableVersion = useUpdateStore((s) => s.availableVersion)
  const releaseNotes = useUpdateStore((s) => s.releaseNotes)
  const progressPercent = useUpdateStore((s) => s.progressPercent)
  const downloadedBytes = useUpdateStore((s) => s.downloadedBytes)
  const totalBytes = useUpdateStore((s) => s.totalBytes)
  const error = useUpdateStore((s) => s.error)
  const shouldPrompt = useUpdateStore((s) => s.shouldPrompt)
  const initialize = useUpdateStore((s) => s.initialize)
  const installUpdate = useUpdateStore((s) => s.installUpdate)
  const dismissPrompt = useUpdateStore((s) => s.dismissPrompt)

  useEffect(() => {
    void initialize()
  }, [initialize])

  if (!isTauriRuntime()) return null

  const showPopup =
    shouldPrompt && !!availableVersion && ['available', 'downloading', 'restarting'].includes(status)

  if (!showPopup) return null

  const hasKnownProgress = typeof totalBytes === 'number' && totalBytes > 0
  const downloadedText = formatBytes(downloadedBytes)
  const statusText =
    status === 'restarting'
      ? t('update.restarting')
      : status === 'downloading'
        ? hasKnownProgress
          ? t('update.downloading')
          : t('update.progressBytes', { downloaded: downloadedText })
        : null

  return (
    <div className="fixed top-4 right-4 z-[200] max-w-sm">
      <div className="rounded-xl border border-[var(--color-border-separator)] bg-[var(--color-background)] p-4 shadow-[var(--shadow-dropdown)]">
        <p className="text-[14px] font-medium text-[var(--color-text-primary)]">
          {t('update.available', { version: availableVersion })}
        </p>

        {releaseNotes && (
          <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] px-3 py-2">
            <MarkdownRenderer
              content={releaseNotes}
              className="text-[12px] leading-5 text-[var(--color-text-secondary)] [&_h1]:mb-2 [&_h1]:text-[14px] [&_h1]:font-semibold [&_h2]:mb-1.5 [&_h2]:text-[12px] [&_h2]:font-semibold [&_p]:my-1.5 [&_p]:text-[12px] [&_p]:leading-5 [&_ul]:my-1.5 [&_ol]:my-1.5"
            />
          </div>
        )}

        {(status === 'downloading' || status === 'restarting') && (
          <div className="mt-3">
            <div className="h-1.5 bg-[var(--color-surface)] rounded-full overflow-hidden">
              {hasKnownProgress || status === 'restarting' ? (
                <div
                  className="h-full bg-[var(--color-text-accent)] transition-all duration-300"
                  style={{ width: `${Math.min(progressPercent, 100)}%` }}
                />
              ) : (
                <div className="h-full w-1/3 rounded-full bg-[var(--color-text-accent)]/75 animate-pulse" />
              )}
            </div>
            {statusText && (
              <p className="text-[12px] text-[var(--color-text-tertiary)] mt-1">
                {statusText}
                {status === 'downloading' && hasKnownProgress ? ` ${progressPercent}%` : ''}
              </p>
            )}
          </div>
        )}

        {error && (
          <p className="mt-2 text-[12px] text-[var(--color-error)]">
            {t('update.failed', { error })}
          </p>
        )}

        {status === 'available' && (
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => void installUpdate()}
            >
              {t('update.now')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={dismissPrompt}
            >
              {t('update.later')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
