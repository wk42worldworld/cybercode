import { useMemo, useState } from 'react'
import { CodeViewer } from './CodeViewer'
import { DiffViewer } from './DiffViewer'
import { TerminalChrome } from './TerminalChrome'
import { CopyButton } from '../shared/CopyButton'
import { useTranslation } from '../../i18n'
import type { TranslationKey } from '../../i18n'
import { InlineImageGallery } from './InlineImageGallery'
import type { AgentTaskNotification } from '../../types/chat'
import { Icon } from '../shared/Icon'

type Props = {
  toolName: string
  input: unknown
  result?: { content: unknown; isError: boolean } | null
  agentTaskNotification?: AgentTaskNotification
  compact?: boolean
  running?: boolean
}

const TOOL_ICONS: Record<string, string> = {
  Bash: 'terminal',
  Read: 'description',
  Write: 'edit_document',
  Edit: 'edit_note',
  Glob: 'search',
  Grep: 'find_in_page',
  Agent: 'smart_toy',
  WebSearch: 'travel_explore',
  WebFetch: 'cloud_download',
  NotebookEdit: 'note',
  Skill: 'auto_awesome',
}

export function ToolCallBlock({ toolName, input, result, compact = false, running }: Props) {
  const [expanded, setExpanded] = useState(false)
  const t = useTranslation()
  const obj = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const icon = TOOL_ICONS[toolName] || 'build'
  const filePath = typeof obj.file_path === 'string' ? obj.file_path : ''
  const isRunning = running ?? !result
  const runningTextClass = isRunning ? ' tool-running-text' : ''
  const summary = getToolSummary(toolName, obj, t)
  const outputSummary = getToolResultSummary(
    toolName,
    result?.content,
    result?.isError ?? false,
    t,
  )

  const preview = useMemo(() => renderPreview(toolName, obj, result, t), [obj, result, toolName, t])
  const details = useMemo(() => renderDetails(toolName, obj, t), [obj, toolName, t])
  const hasResultDetails = Boolean(result && extractTextContent(result.content))
  const expandable = toolName === 'Edit' || toolName === 'Write' || hasResultDetails

  // Left accent line removed — cleaner design

  return (
    <div
      data-running={isRunning ? 'true' : undefined}
      className={`overflow-hidden rounded-[10px] bg-[var(--color-surface-container-low)] ${
        isRunning ? 'tool-running-sweep' : ''
      } ${
        compact ? 'mb-0' : 'mb-1.5'
      }`}
    >
      <div className="min-w-0">
        <button
          type="button"
          onClick={() => {
            if (expandable) {
              setExpanded((value) => !value)
            }
          }}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-100 hover:bg-[var(--color-surface-hover)]"
        >
          <Icon name={icon} size={12} className="text-[var(--color-text-tertiary)]" />
          <span className={`text-[11px] font-medium text-[var(--color-text-secondary)]${runningTextClass}`}>
            {toolName}
          </span>
          {filePath ? (
            <span className={`min-w-0 flex-1 truncate font-[var(--font-mono)] text-[11px] text-[var(--color-text-tertiary)]${runningTextClass}`}>
              {filePath.split('/').pop()}
            </span>
          ) : summary ? (
            <span className={`min-w-0 flex-1 truncate font-[var(--font-mono)] text-[11px] text-[var(--color-text-tertiary)]${runningTextClass}`}>
              {summary}
            </span>
          ) : (
            <span className="flex-1" />
          )}
          {result && outputSummary && (
            <span
              className={`shrink-0 text-[10px] ${
                result.isError
                  ? 'text-[var(--color-error)]'
                  : 'text-[var(--color-outline)]'
              }`}
            >
              {outputSummary}
            </span>
          )}
          {result?.isError && (
            <Icon name="error" size={18} className="shrink-0 text-[14px] text-[var(--color-error)]" />
          )}
          {expandable && (
            <Icon
              name={expanded ? 'expand_less' : 'expand_more'}
              size={14}
              className="text-[var(--color-outline)] transition-transform duration-200"
              style={{ transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)' }}
            />
          )}
        </button>

        {expandable && expanded && (
          <div
            className="space-y-2 border-t border-[var(--color-border-separator)] px-3 py-2.5"
            style={{
              animation: 'fade-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {preview}
            {details}
          </div>
        )}
      </div>
    </div>
  )
}

function renderPreview(
  toolName: string,
  obj: Record<string, unknown>,
  result?: { content: unknown; isError: boolean } | null,
  t?: (key: TranslationKey, params?: Record<string, string | number>) => string,
) {
  const filePath = typeof obj.file_path === 'string' ? obj.file_path : 'file'

  if (toolName === 'Edit' && typeof obj.old_string === 'string' && typeof obj.new_string === 'string') {
    return <DiffViewer filePath={filePath} oldString={obj.old_string} newString={obj.new_string} />
  }

  if (toolName === 'Write' && typeof obj.content === 'string') {
    return <DiffViewer filePath={filePath} oldString="" newString={obj.content} />
  }

  if (toolName === 'Bash' && typeof obj.command === 'string') {
    return (
      <TerminalChrome title={typeof obj.description === 'string' ? obj.description : filePath}>
        <div className="px-3 py-2.5 font-[var(--font-mono)] text-[11px] leading-[1.3] text-[var(--color-terminal-fg)]">
          <span className="text-[var(--color-brand)]">$</span> {obj.command}
        </div>
      </TerminalChrome>
    )
  }

  if (toolName === 'Read') {
    return null
  }

  if (result) {
    const text = extractTextContent(result.content)
    if (text) {
      return (
        <>
          <InlineImageGallery text={text} />
          <div className={`overflow-hidden rounded-lg border-2 ${
            result.isError
              ? 'border-[var(--color-error)]/40 bg-[var(--color-error-container)]/60'
              : 'border-[var(--color-border)] bg-[var(--color-code-bg)]'
          }`}>
            <div className="flex items-center justify-between border-b border-[var(--color-border-separator)] px-3 py-2">
              <span className="label-micro text-[var(--color-outline)]">
                {result.isError ? t?.('tool.errorOutput') ?? 'Error Output' : t?.('tool.toolOutput') ?? 'Tool Output'}
              </span>
              <CopyButton
                text={text}
                className="btn-ghost px-2 py-1 text-[10px] text-[var(--color-text-tertiary)] hover:text-[var(--color-brand)]"
              />
            </div>
            <CodeViewer code={text} language="plaintext" maxLines={18} />
          </div>
        </>
      )
    }
  }

  return null
}

function renderDetails(toolName: string, obj: Record<string, unknown>, t?: (key: TranslationKey, params?: Record<string, string | number>) => string) {
  if (toolName === 'Edit' || toolName === 'Write') {
    return null
  }

  const text = JSON.stringify(obj, null, 2)
  return (
    <div className="overflow-hidden rounded-lg border-2 border-[var(--color-border)] bg-[var(--color-code-bg)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border-separator)] px-3 py-2">
        <span className="label-micro text-[var(--color-outline)]">
          {t?.('tool.toolInput') ?? 'Tool Input'}
        </span>
        <CopyButton
          text={text}
          className="btn-ghost px-2 py-1 text-[10px] text-[var(--color-text-tertiary)] hover:text-[var(--color-brand)]"
        />
      </div>
      <CodeViewer code={text} language="json" maxLines={18} />
    </div>
  )
}

function getToolResultSummary(
  toolName: string,
  content: unknown,
  isError: boolean,
  t?: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  const text = extractTextContent(content)
  if (!text) return ''

  if (isError) {
    const firstLine = text
      .split('\n')
      .map((line) => stripAnsi(line).replace(/\s+/g, ' ').trim())
      .find(Boolean)

    if (!firstLine) {
      return t?.('tool.error') ?? 'Error'
    }

    return firstLine.length <= 72 ? firstLine : `${firstLine.slice(0, 72)}…`
  }

  if (toolName === 'Bash') return ''

  const lineCount = text.split('\n').length
  if (lineCount > 1) {
    return t?.('tool.linesOutput', { count: lineCount }) ?? `${lineCount} lines output`
  }

  const compact = text.replace(/\s+/g, ' ').trim()
  if (!compact) return ''
  if (compact.length <= 36) return compact
  return `${compact.slice(0, 36)}…`
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-9;]*m/g, '')
}

function getToolSummary(toolName: string, obj: Record<string, unknown>, t?: (key: TranslationKey, params?: Record<string, string | number>) => string): string {
  switch (toolName) {
    case 'Bash':
      return typeof obj.command === 'string' ? obj.command : ''
    case 'Read':
      return t?.('tool.readFileContents') ?? 'Read file contents'
    case 'Write':
      return typeof obj.content === 'string'
        ? (t?.('tool.linesCreated', { count: obj.content.split('\n').length }) ?? `${obj.content.split('\n').length} lines created`)
        : (t?.('tool.createFile') ?? 'Create file')
    case 'Edit':
      return typeof obj.old_string === 'string' && typeof obj.new_string === 'string'
        ? changedLineSummary(obj.old_string, obj.new_string, t)
        : (t?.('tool.updateFileContents') ?? 'Update file contents')
    case 'Glob':
      return typeof obj.pattern === 'string' ? obj.pattern : ''
    case 'Grep':
      return typeof obj.pattern === 'string' ? obj.pattern : ''
    case 'Agent':
      return typeof obj.description === 'string' ? obj.description : ''
    default:
      return ''
  }
}

function extractTextContent(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((chunk: any) => (typeof chunk === 'string' ? chunk : chunk?.text || ''))
      .filter(Boolean)
      .join('\n')
  }
  if (content && typeof content === 'object') {
    return JSON.stringify(content, null, 2)
  }
  return null
}

function changedLineSummary(oldString: string, newString: string, t?: (key: TranslationKey, params?: Record<string, string | number>) => string): string {
  const oldLines = oldString.split('\n')
  const newLines = newString.split('\n')
  let changed = 0
  const max = Math.max(oldLines.length, newLines.length)

  for (let index = 0; index < max; index += 1) {
    if ((oldLines[index] ?? '') !== (newLines[index] ?? '')) {
      changed += 1
    }
  }

  return t?.('tool.linesChanged', { count: changed }) ?? `${changed} lines changed`
}
