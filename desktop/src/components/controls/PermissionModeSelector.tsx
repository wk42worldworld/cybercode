import { useState, useRef, useEffect } from 'react'
import DOMPurify from 'dompurify'
import { createPortal } from 'react-dom'
import { useSettingsStore } from '../../stores/settingsStore'
import { useChatStore } from '../../stores/chatStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTabStore } from '../../stores/tabStore'
import { useTranslation } from '../../i18n'
import type { PermissionMode } from '../../types/settings'
import { Icon } from '../shared/Icon'

const MODE_ICONS: Record<PermissionMode, string> = {
  default: 'verified_user',
  acceptEdits: 'bolt',
  plan: 'architecture',
  bypassPermissions: 'gavel',
  dontAsk: 'gavel',
}

type Props = {
  workDir?: string
  /** Controlled mode: override current value */
  value?: PermissionMode
  /** Controlled mode: called on change instead of updating global store */
  onChange?: (mode: PermissionMode) => void
}

export function PermissionModeSelector({ workDir: workDirProp, value, onChange }: Props = {}) {
  const t = useTranslation()
  const { permissionMode: storeMode, setPermissionMode } = useSettingsStore()
  const setSessionPermissionMode = useChatStore((s) => s.setSessionPermissionMode)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const [open, setOpen] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const isControlled = value !== undefined
  const currentMode = isControlled ? value : storeMode

  const PERMISSION_ITEMS: Array<{
    value: PermissionMode
    label: string
    description: string
    icon: string
    color?: string
  }> = [
    {
      value: 'default',
      label: t('permMode.askPermissions'),
      description: t('permMode.askPermDesc'),
      icon: 'verified_user',
    },
    {
      value: 'acceptEdits',
      label: t('permMode.autoAccept'),
      description: t('permMode.autoAcceptDesc'),
      icon: 'bolt',
    },
    {
      value: 'plan',
      label: t('permMode.planMode'),
      description: t('permMode.planModeDesc'),
      icon: 'architecture',
      color: 'text-[var(--color-text-tertiary)]',
    },
    {
      value: 'bypassPermissions',
      label: t('permMode.bypass'),
      description: t('permMode.bypassDesc'),
      icon: 'gavel',
      color: 'text-[var(--color-error)]',
    },
  ]

  const MODE_LABELS: Record<PermissionMode, string> = {
    default: t('permMode.label.default'),
    acceptEdits: t('permMode.label.acceptEdits'),
    plan: t('permMode.label.plan'),
    bypassPermissions: t('permMode.label.bypassPermissions'),
    dontAsk: t('permMode.label.dontAsk'),
  }

  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const workDir = workDirProp || activeSession?.workDir || '~'

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[var(--color-surface-container)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] rounded-md text-[12px] font-medium text-[var(--color-text-secondary)] transition-colors"
      >
        <Icon name={MODE_ICONS[currentMode]} size={14} />
        <span>{MODE_LABELS[currentMode]}</span>
        <Icon name="expand_more" size={12} />
      </button>

      {open && (
        <div className="absolute left-0 bottom-full mb-1.5 w-[280px] rounded-xl border border-[var(--color-border-separator)] bg-[var(--color-background)] shadow-[var(--shadow-dropdown)] z-50 py-2 px-1.5">
          <div className="px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
            {t('permMode.executionPermissions')}
          </div>
          {PERMISSION_ITEMS.map((item) => (
            <button
              key={item.value}
              onClick={() => {
                if (item.value === 'bypassPermissions') {
                  setOpen(false)
                  setConfirmDialog(true)
                  return
                }
                if (isControlled) {
                  onChange?.(item.value)
                } else {
                  void setPermissionMode(item.value)
                  if (activeTabId) setSessionPermissionMode(activeTabId, item.value)
                }
                setOpen(false)
              }}
              className={`
                w-full flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-left transition-all duration-150 group
                ${item.value === currentMode ? 'bg-[var(--color-surface-selected)]' : 'hover:bg-[var(--color-surface-hover)]'}
              `}
            >
              <Icon name={item.icon} size={16} className={`mt-0.5 shrink-0 ${item.color || 'text-[var(--color-text-tertiary)]'}`} />
              <div className="flex-1 min-w-0">
                <div className={`truncate text-[13px] ${item.value === currentMode ? 'font-semibold text-[var(--color-text-primary)]' : 'font-medium text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]'}`}>
                  {item.label}
                </div>
                <div className="text-[10px] text-[var(--color-text-tertiary)] mt-px leading-relaxed">
                  {item.description}
                </div>
              </div>
              {item.value === currentMode && (
                <Icon name="check" size={14} className="shrink-0 mt-0.5 text-[var(--color-text-tertiary)]" />
              )}
            </button>
          ))}
        </div>
      )}

      {/* Bypass confirmation dialog */}
      {confirmDialog && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--color-overlay-scrim)] pl-[var(--sidebar-width)]" onClick={() => setConfirmDialog(false)}>
          <div
            className="w-[420px] rounded-xl bg-[var(--color-background)] border border-[var(--color-border-separator)] shadow-[var(--shadow-window)] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 bg-[var(--color-error)]/8 border-b border-[var(--color-error)]/15">
              <div className="flex items-center justify-center w-10 h-10 rounded-md bg-[var(--color-error)]/12">
                <Icon name="warning" size={22} className="text-[var(--color-error)]" />
              </div>
              <div>
                <div className="text-[14px] font-bold text-[var(--color-text-primary)]">{t('permMode.enableBypassTitle')}</div>
                <div className="text-[12px] text-[var(--color-text-tertiary)] mt-0.5">{t('permMode.enableBypassSubtitle')}</div>
              </div>
            </div>

            {/* Body */}
            <div className="px-5 py-4">
              <p className="text-[12px] text-[var(--color-text-secondary)] leading-relaxed mb-3" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(t('permMode.enableBypassBody')) }} />
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--color-surface-container-low)] border border-[var(--color-border-separator)]" title={workDir}>
                <Icon name="folder" size={16} className="text-[var(--color-text-tertiary)] shrink-0" />
                <code className="text-[12px] font-mono text-[var(--color-text-secondary)] truncate">{workDir}</code>
              </div>
              <ul className="mt-3 space-y-1.5 text-[12px] text-[var(--color-text-secondary)]">
                <li className="flex items-start gap-2">
                  <Icon name="check" size={14} className="text-[var(--color-error)] mt-0.5" />
                  {t('permMode.permReadWrite')}
                </li>
                <li className="flex items-start gap-2">
                  <Icon name="check" size={14} className="text-[var(--color-error)] mt-0.5" />
                  {t('permMode.permShell')}
                </li>
                <li className="flex items-start gap-2">
                  <Icon name="check" size={14} className="text-[var(--color-error)] mt-0.5" />
                  {t('permMode.permPackages')}
                </li>
              </ul>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)]">
              <button
                onClick={() => setConfirmDialog(false)}
                className="px-4 py-2 text-[12px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] rounded-lg transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => {
                  if (isControlled) {
                    onChange?.('bypassPermissions')
                  } else {
                    void setPermissionMode('bypassPermissions')
                    if (activeTabId) setSessionPermissionMode(activeTabId, 'bypassPermissions')
                  }
                  setConfirmDialog(false)
                }}
                className="px-4 py-2 text-[12px] font-semibold text-[var(--color-btn-danger-fg)] bg-[var(--color-error)] hover:opacity-90 rounded-lg transition-colors"
              >
                {t('permMode.enableBypassBtn')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
