import { useMemo, useState } from 'react'
import { useTranslation } from '../../i18n'
import { Button } from '../shared/Button'
import { Icon } from '../shared/Icon'

const LOG_MARKER = '\n\nRecent server logs:\n'

export function splitStartupError(error: string) {
  const markerIndex = error.indexOf(LOG_MARKER)
  if (markerIndex === -1) {
    return {
      message: error,
      logs: '',
      diagnostics: error,
    }
  }

  const message = error.slice(0, markerIndex).trim()
  const logs = error.slice(markerIndex + LOG_MARKER.length).trim()
  return {
    message,
    logs,
    diagnostics: `${message}\n\nRecent server logs:\n${logs}`,
  }
}

type StartupErrorViewProps = {
  error: string
}

export function StartupErrorView({ error }: StartupErrorViewProps) {
  const t = useTranslation()
  const { message, logs, diagnostics } = useMemo(() => splitStartupError(error), [error])
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard?.writeText(diagnostics)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="h-screen flex items-center justify-center bg-[var(--color-surface)] px-6">
      <section className="w-full max-w-3xl rounded-lg border-2 border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-6 shadow-[var(--shadow-md)]">
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="text-[18px] font-semibold text-[var(--color-text-primary)]">
              {t('app.serverFailed')}
            </h1>
            <p className="mt-2 text-[14px] text-[var(--color-text-secondary)]">
              {t('app.serverFailedHint')}
            </p>
          </div>

          <div className="rounded-lg border-2 border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <div className="text-[12px] font-medium uppercase text-[var(--color-text-tertiary)]">
              {t('app.startupError')}
            </div>
            <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] text-[var(--color-error)]">
              {message}
            </pre>
          </div>

          {logs ? (
            <div className="rounded-lg border-2 border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <div className="text-[12px] font-medium uppercase text-[var(--color-text-tertiary)]">
                {t('app.serverLogs')}
              </div>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-[var(--color-text-secondary)]">
                {logs}
              </pre>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={<Icon name="content_copy" size={16} />}
              onClick={handleCopy}
            >
              {copied ? t('app.copiedDiagnostics') : t('app.copyDiagnostics')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={<Icon name="refresh" size={16} />}
              onClick={() => window.location.reload()}
            >
              {t('common.retry')}
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
