import { useState } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'
import { useTranslation } from '../../i18n'
import type { TranslationKey } from '../../i18n'
import { DiffViewer } from './DiffViewer'
import { Icon } from '../shared/Icon'

type Props = {
  requestId: string
  toolName: string
  input: unknown
  description?: string
}

/**
 * Icons for known tool types.
 * Uses shared Icon registry names.
 */
const TOOL_META: Record<string, { icon: string; label: string; color: string }> = {
  Bash: { icon: 'terminal', label: 'Bash', color: 'var(--color-warning)' },
  Edit: { icon: 'edit_note', label: 'Edit File', color: 'var(--color-brand)' },
  Write: { icon: 'edit_document', label: 'Write File', color: 'var(--color-success)' },
  Read: { icon: 'description', label: 'Read File', color: 'var(--color-secondary)' },
  Glob: { icon: 'search', label: 'Glob Search', color: 'var(--color-secondary)' },
  Grep: { icon: 'find_in_page', label: 'Grep Search', color: 'var(--color-secondary)' },
  Agent: { icon: 'smart_toy', label: 'Agent', color: 'var(--color-tertiary)' },
  WebSearch: { icon: 'travel_explore', label: 'Web Search', color: 'var(--color-secondary)' },
  WebFetch: { icon: 'cloud_download', label: 'Web Fetch', color: 'var(--color-secondary)' },
  NotebookEdit: { icon: 'note', label: 'Notebook Edit', color: 'var(--color-brand)' },
  Skill: { icon: 'auto_awesome', label: 'Skill', color: 'var(--color-tertiary)' },
}

function isPlanApprovalTool(toolName: string): boolean {
  const normalized = toolName.replace(/[_-]/g, '').toLowerCase()
  return normalized === 'exitplanmode' || normalized === 'exitplanmodev2'
}

function extractPlanDetails(input: unknown): { plan: string; planFilePath: string } {
  const obj = (input && typeof input === 'object') ? input as Record<string, unknown> : {}
  return {
    plan: typeof obj.plan === 'string' ? obj.plan : '',
    planFilePath: typeof obj.planFilePath === 'string' ? obj.planFilePath : '',
  }
}

/**
 * Extract human-readable detail lines from tool input.
 */
function extractToolDetails(toolName: string, input: unknown, t: (key: TranslationKey, params?: Record<string, string | number>) => string): { primary: string; secondary?: string } {
  const obj = (input && typeof input === 'object') ? input as Record<string, unknown> : {}

  switch (toolName) {
    case 'Bash': {
      const cmd = typeof obj.command === 'string' ? obj.command : ''
      const desc = typeof obj.description === 'string' ? obj.description : undefined
      return { primary: cmd, secondary: desc }
    }
    case 'Edit': {
      const filePath = typeof obj.file_path === 'string' ? obj.file_path : ''
      return { primary: filePath, secondary: obj.old_string ? t('permission.replacingContent') : undefined }
    }
    case 'Write': {
      const filePath = typeof obj.file_path === 'string' ? obj.file_path : ''
      return { primary: filePath }
    }
    case 'Read': {
      const filePath = typeof obj.file_path === 'string' ? obj.file_path : ''
      return { primary: filePath }
    }
    case 'Glob':
      return { primary: typeof obj.pattern === 'string' ? obj.pattern : '' }
    case 'Grep':
      return { primary: typeof obj.pattern === 'string' ? obj.pattern : '' }
    case 'Agent':
      return { primary: typeof obj.description === 'string' ? obj.description : '' }
    case 'WebSearch':
      return { primary: typeof obj.query === 'string' ? obj.query : '' }
    case 'WebFetch':
      return { primary: typeof obj.url === 'string' ? obj.url : '' }
    default:
      return { primary: typeof input === 'string' ? input : JSON.stringify(input, null, 2) }
  }
}

function renderPermissionPreview(toolName: string, input: unknown) {
  const obj = (input && typeof input === 'object') ? input as Record<string, unknown> : {}
  const filePath = typeof obj.file_path === 'string' ? obj.file_path : 'file'

  if (toolName === 'Edit' && typeof obj.old_string === 'string' && typeof obj.new_string === 'string') {
    return <DiffViewer filePath={filePath} oldString={obj.old_string} newString={obj.new_string} />
  }

  if (toolName === 'Write' && typeof obj.content === 'string') {
    return <DiffViewer filePath={filePath} oldString="" newString={obj.content} />
  }

  if (toolName === 'Bash' && typeof obj.command === 'string') {
    return (
      <div className="overflow-x-auto rounded-[var(--radius-md)] bg-[var(--color-terminal-bg)] px-3 py-2.5">
        <pre className="font-[var(--font-mono)] text-[11px] leading-[1.3] text-[var(--color-terminal-fg)] whitespace-pre-wrap break-words">
          <span className="text-[var(--color-terminal-accent)] select-none">$ </span>{obj.command}
        </pre>
      </div>
    )
  }

  return null
}

export function PermissionDialog({ requestId, toolName, input, description }: Props) {
  const { respondToPermission } = useChatStore()
  const activeTabId = useTabStore((s) => s.activeTabId)
  const pendingPermission = useChatStore((s) => activeTabId ? s.sessions[activeTabId]?.pendingPermission : undefined)
  const t = useTranslation()
  const isPending = pendingPermission?.requestId === requestId
  const [showRaw, setShowRaw] = useState(false)
  const isPlanApproval = isPlanApprovalTool(toolName)
  const planDetails = extractPlanDetails(input)

  const meta = isPlanApproval
    ? { icon: 'checklist', label: t('permission.planTitle'), color: 'var(--color-brand)' }
    : TOOL_META[toolName] || { icon: 'shield', label: toolName, color: 'var(--color-text-tertiary)' }
  const details = isPlanApproval ? { primary: '' } : extractToolDetails(toolName, input, t)
  const rawInput = typeof input === 'string' ? input : JSON.stringify(input, null, 2)
  const preview = isPlanApproval ? null : renderPermissionPreview(toolName, input)
  const allowRawToggle = !isPlanApproval && !preview

  if (!isPending) {
    return (
      <div
        data-permission-kind={isPlanApproval ? 'plan' : 'tool'}
        data-permission-state="responded"
        className="mb-2 inline-flex w-fit max-w-full items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container)] px-3 py-1.5 text-[11px] text-[var(--color-text-tertiary)] opacity-70"
      >
        <Icon name={meta.icon} size={13} className={isPlanApproval ? 'text-[var(--color-brand)]' : 'text-[var(--color-outline)]'} />
        <span className="min-w-0 truncate font-medium text-[var(--color-text-secondary)]">
          {meta.label}
        </span>
        <span className="shrink-0">
          {isPlanApproval ? t('permission.planHandled') : t('permission.responded')}
        </span>
      </div>
    )
  }

  return (
    <div
      data-permission-kind={isPlanApproval ? 'plan' : 'tool'}
      data-permission-state="pending"
      className={`mb-2 flex w-full overflow-hidden rounded-[var(--radius-lg)] bg-[var(--color-surface-container)] ${
        isPlanApproval ? 'max-w-[640px]' : 'max-w-[720px]'
      }`}
    >
      {/* Left accent vertical line — same style as ToolCallBlock. */}
      <div className={`w-0.5 shrink-0 animate-accent-pulse-line ${
        isPlanApproval ? 'bg-[var(--color-brand)]' : 'bg-[var(--color-warning)]'
      }`} />

      <div className="min-w-0 flex-1">
        {/* Header: tool name + current decision state. */}
        <div className="flex items-center gap-2 px-3 py-2">
          <Icon name={meta.icon} size={14} className={isPlanApproval ? 'text-[var(--color-brand)]' : 'text-[var(--color-warning)]'} />
          <span className={`label-micro ${isPlanApproval ? 'text-[var(--color-brand)]' : 'text-[var(--color-warning)]'}`}>
            {meta.label}
          </span>
          <span className={`inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
            isPlanApproval
              ? 'bg-[var(--color-brand)]/10 text-[var(--color-brand)]'
              : 'bg-[var(--color-warning)]/12 text-[var(--color-warning)]'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full animate-pulse-glow ${
              isPlanApproval ? 'bg-[var(--color-brand)]' : 'bg-[var(--color-warning)]'
            }`} />
            {isPlanApproval ? t('permission.planAwaiting') : t('permission.awaitingApproval')}
          </span>
          {description && (
            <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--color-text-tertiary)]">
              {description}
            </span>
          )}
          {!description && <span className="flex-1" />}
        </div>

        {isPlanApproval && (
          <div className="space-y-2 px-3 pb-2">
            <p className="text-[11px] leading-4 text-[var(--color-text-tertiary)]">
              {t('permission.planExplanation')}
            </p>
            {(planDetails.plan || planDetails.planFilePath) && (
              <div className="rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] px-3 py-2">
                {planDetails.plan && (
                  <pre className={`whitespace-pre-wrap break-words font-[var(--font-sans)] text-[11px] leading-[1.55] text-[var(--color-text-secondary)] ${
                    showRaw ? 'max-h-[280px] overflow-y-auto' : 'max-h-[70px] overflow-hidden'
                  }`}>
                    {planDetails.plan}
                  </pre>
                )}
                {!planDetails.plan && planDetails.planFilePath && (
                  <div className="flex min-w-0 items-center gap-2 font-[var(--font-mono)] text-[10px] text-[var(--color-text-secondary)]">
                    <Icon name="description" size={12} className="shrink-0 text-[var(--color-outline)]" />
                    <span className="truncate">{planDetails.planFilePath}</span>
                  </div>
                )}
                {planDetails.plan && (
                  <button
                    type="button"
                    onClick={() => setShowRaw(!showRaw)}
                    className="mt-1.5 flex cursor-pointer items-center gap-1 text-[10px] text-[var(--color-text-accent)] hover:underline"
                  >
                    <Icon name={showRaw ? 'expand_less' : 'expand_more'} size={12} />
                    {showRaw ? t('permission.hidePlan') : t('permission.showPlan')}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Detail: file path, command, or other description */}
        {!isPlanApproval && (details.primary || preview) && (
          <div className="space-y-1.5 px-3 pb-2">
            {details.primary && !preview ? (
              <div className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] px-3 py-1.5 text-[11px] font-[var(--font-mono)] text-[var(--color-text-secondary)]">
                <Icon name={toolName === 'Glob' || toolName === 'Grep' ? 'search' : 'folder_open'} size={12} className="text-[var(--color-outline)] flex-shrink-0" />
                <span className="truncate">{details.primary}</span>
              </div>
            ) : null}

            {details.primary && preview && toolName !== 'Bash' ? (
              <div className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] px-3 py-1.5 text-[11px] font-[var(--font-mono)] text-[var(--color-text-secondary)]">
                <Icon name="folder_open" size={12} className="text-[var(--color-outline)] flex-shrink-0" />
                <span className="truncate">{details.primary}</span>
              </div>
            ) : null}

            {preview}

            {details.secondary && (
              <p className="text-[11px] text-[var(--color-text-tertiary)]">{details.secondary}</p>
            )}

            {allowRawToggle && (
              <button
                onClick={() => setShowRaw(!showRaw)}
                className="flex cursor-pointer items-center gap-1 text-[10px] text-[var(--color-text-accent)] hover:underline"
              >
                <Icon name={showRaw ? 'expand_less' : 'expand_more'} size={12} />
                {showRaw ? t('permission.hideDetails') : t('permission.showFullInput')}
              </button>
            )}

            {allowRawToggle && showRaw && (
              <pre className="max-h-[160px] overflow-y-auto overflow-x-auto rounded-[var(--radius-md)] bg-[var(--color-terminal-bg)] px-3 py-2 font-[var(--font-mono)] text-[11px] leading-[1.3] text-[var(--color-terminal-fg)] whitespace-pre-wrap break-words">
                {rawInput}
              </pre>
            )}
          </div>
        )}

        {/* Action buttons — inline row at the bottom, no backdrop-blur */}
        <div className="flex items-center gap-1.5 border-t border-[var(--color-border-separator)] px-3 py-1.5">
          <button
            type="button"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[var(--radius-sm)] text-[11px] font-semibold text-[var(--color-btn-primary-fg)] bg-[var(--color-btn-primary-bg)] hover:bg-[var(--color-btn-primary-bg-hover)] transition-colors cursor-pointer"
            onClick={() => activeTabId && respondToPermission(activeTabId, requestId, true)}
          >
            <Icon name="check" size={12} />
            {isPlanApproval ? t('permission.planStart') : t('permission.allow')}
          </button>
          {!isPlanApproval && (
            <button
              type="button"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[var(--radius-sm)] text-[11px] font-medium text-[var(--color-text-secondary)] bg-[var(--color-surface-container-low)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] transition-colors cursor-pointer"
              onClick={() => activeTabId && respondToPermission(activeTabId, requestId, true, { rule: 'always' })}
            >
              <Icon name="verified" size={12} />
              {t('permission.allowForSession')}
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[var(--radius-sm)] text-[11px] font-semibold text-[var(--color-btn-danger-fg)] bg-[var(--color-error)] hover:opacity-90 transition-opacity cursor-pointer"
            onClick={() => activeTabId && respondToPermission(activeTabId, requestId, false)}
          >
            <Icon name="close" size={12} />
            {isPlanApproval ? t('permission.planRevise') : t('permission.deny')}
          </button>
        </div>
      </div>
    </div>
  )
}
