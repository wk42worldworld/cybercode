import { useEffect, useState } from 'react'
import { ToolCallBlock } from './ToolCallBlock'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { Modal } from '../shared/Modal'
import { useTranslation } from '../../i18n'
import type { TranslationKey } from '../../i18n'
import type { AgentTaskNotification, UIMessage } from '../../types/chat'
import { AGENT_LIFECYCLE_TYPES } from '../../types/team'
import { Icon } from '../shared/Icon'

type ToolCall = Extract<UIMessage, { type: 'tool_use' }>
type ToolResult = Extract<UIMessage, { type: 'tool_result' }>

type Props = {
  toolCalls: ToolCall[]
  resultMap: Map<string, ToolResult>
  childToolCallsByParent: Map<string, ToolCall[]>
  agentTaskNotifications: Record<string, AgentTaskNotification>
  /** When true, the last tool is still executing — show expanded */
  isStreaming?: boolean
}

const TOOL_VERBS: Record<string, (count: number, t: (key: TranslationKey, params?: Record<string, string | number>) => string) => string> = {
  Read: (n, t) => n === 1 ? t('toolGroup.readOne') : t('toolGroup.readMany', { count: n }),
  Write: (n, t) => n === 1 ? t('toolGroup.createdOne') : t('toolGroup.createdMany', { count: n }),
  Edit: (n, t) => n === 1 ? t('toolGroup.editedOne') : t('toolGroup.editedMany', { count: n }),
  Bash: (n, t) => n === 1 ? t('toolGroup.ranOne') : t('toolGroup.ranMany', { count: n }),
  Glob: (_n, t) => t('toolGroup.foundFiles'),
  Grep: (n, t) => n === 1 ? t('toolGroup.searchedOne') : t('toolGroup.searchedMany', { count: n }),
  CodeGraph: (n, t) => n === 1 ? t('toolGroup.searchedOne') : t('toolGroup.searchedMany', { count: n }),
  Agent: (n, t) => n === 1 ? t('toolGroup.agentOne') : t('toolGroup.agentMany', { count: n }),
  WebSearch: (_n, t) => t('toolGroup.searchedWeb'),
  WebFetch: (n, t) => n === 1 ? t('toolGroup.fetchedOne') : t('toolGroup.fetchedMany', { count: n }),
}

function generateSummary(toolCalls: ToolCall[], t: (key: TranslationKey, params?: Record<string, string | number>) => string): string {
  const counts = new Map<string, number>()
  for (const tc of toolCalls) {
    counts.set(tc.toolName, (counts.get(tc.toolName) ?? 0) + 1)
  }

  const parts: string[] = []
  for (const [name, count] of counts) {
    const verbFn = TOOL_VERBS[name]
    parts.push(verbFn ? verbFn(count, t) : `${name} (${count})`)
  }

  return parts.join(', ')
}

function groupHasErrors(toolCalls: ToolCall[], resultMap: Map<string, ToolResult>): boolean {
  return toolCalls.some((tc) => {
    const result = resultMap.get(tc.toolUseId)
    return result?.isError
  })
}

export function ToolCallGroup({
  toolCalls,
  resultMap,
  childToolCallsByParent,
  agentTaskNotifications,
  isStreaming = true,
}: Props) {
  const allAgents = toolCalls.every((toolCall) => toolCall.toolName === 'Agent')

  if (allAgents) {
    return (
      <AgentToolGroup
        toolCalls={toolCalls}
        resultMap={resultMap}
        childToolCallsByParent={childToolCallsByParent}
        agentTaskNotifications={agentTaskNotifications}
        isStreaming={isStreaming}
      />
    )
  }

  // Single tool call — render directly without group wrapper
  if (toolCalls.length === 1) {
    const tc = toolCalls[0]!
    return (
      <ToolCallTree
        toolCall={tc}
        resultMap={resultMap}
        childToolCallsByParent={childToolCallsByParent}
        isActive={isStreaming}
      />
    )
  }

  return (
    <ToolCallGroupMulti
      toolCalls={toolCalls}
      resultMap={resultMap}
      childToolCallsByParent={childToolCallsByParent}
      agentTaskNotifications={agentTaskNotifications}
      isStreaming={isStreaming}
    />
  )
}

function AgentToolGroup({
  toolCalls,
  resultMap,
  childToolCallsByParent,
  agentTaskNotifications,
  isStreaming,
}: Props) {
  const [expanded, setExpanded] = useState(true)
  const t = useTranslation()
  const statuses = toolCalls.map((toolCall) =>
    getAgentStatus({
      hasResult: resultMap.has(toolCall.toolUseId),
      isError: !!resultMap.get(toolCall.toolUseId)?.isError,
      isLaunchResult: isAgentLaunchResult(resultMap.get(toolCall.toolUseId)?.content),
      isStreaming: !!isStreaming && !resultMap.has(toolCall.toolUseId),
      childCount: (childToolCallsByParent.get(toolCall.toolUseId) ?? []).length,
      taskStatus: agentTaskNotifications[toolCall.toolUseId]?.status,
    }),
  )
  const isAnyRunning = statuses.some((status) => status === 'running' || status === 'starting')
  const errorPresent = statuses.some((status) => status === 'failed')
  const allComplete = statuses.every((status) => status === 'done')
  const anyStopped = statuses.some((status) => status === 'stopped')

  useEffect(() => {
    if (isStreaming) {
      setExpanded(true)
    }
  }, [isStreaming])

  return (
    <div
      data-running={isAnyRunning ? 'true' : undefined}
      className={`mb-2 overflow-hidden rounded-[var(--radius-lg)] bg-[var(--color-surface-container)] ${isAnyRunning ? 'tool-running-sweep' : ''}`}
    >
      {/* Left accent line */}
      <div className="flex">
        <div className={`w-0.5 shrink-0 ${isAnyRunning ? 'bg-[var(--color-brand)] animate-accent-pulse-line' : 'bg-[var(--color-brand)]'}`} />
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex flex-1 items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-[var(--color-surface-hover)]/50"
        >
          <Icon name={expanded ? 'expand_less' : 'expand_more'} size={14} className="text-[var(--color-outline)] transition-transform duration-200" style={{ transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)' }} />
          <span className={`flex-1 truncate text-[12px] text-[var(--color-text-secondary)] ${isAnyRunning ? 'tool-running-text' : ''}`}>
            {toolCalls.length === 1 ? t('toolGroup.agentOne') : t('toolGroup.agentMany', { count: toolCalls.length })}
          </span>
          <span className={`label-micro text-[var(--color-text-tertiary)] ${isAnyRunning ? 'tool-running-text' : ''}`}>
            {toolCalls.length}
          </span>
          {isAnyRunning && (
            <span className="tool-running-text rounded-full bg-[var(--color-brand)]/12 px-2 py-0.5 text-[10px] font-semibold text-[var(--color-brand)]">
              {t('agentStatus.running')}
            </span>
          )}
          {!isAnyRunning && errorPresent && (
            <Icon name="error" size={14} className="text-[var(--color-error)]" />
          )}
          {!isAnyRunning && !errorPresent && allComplete && (
            <Icon name="check_circle" size={14} className="text-[var(--color-success)]" />
          )}
          {!isAnyRunning && !errorPresent && !allComplete && !anyStopped && (
            <Icon name="pending" size={14} className="text-[var(--color-outline)]" />
          )}
          {!isAnyRunning && !errorPresent && !allComplete && anyStopped && (
            <Icon name="stop_circle" size={14} className="text-[var(--color-outline)]" />
          )}
        </button>
      </div>

      {expanded && (
        <div
          className="relative pl-5"
          style={{ animation: 'fade-in 200ms cubic-bezier(0.16, 1, 0.3, 1)' }}
        >
          <div className="absolute bottom-6 left-[11px] top-4 w-px rounded-full bg-[var(--color-border-separator)]" />
          <div className="space-y-2">
            {toolCalls.map((toolCall) => (
              <div key={toolCall.id} className="relative pl-7">
                <div className="absolute left-0 top-1/2 -translate-y-1/2">
                  <div className="absolute left-[11px] top-1/2 h-px w-4 -translate-y-1/2 bg-[var(--color-border-separator)]" />
                  <div className="absolute left-[8px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border-2 border-[var(--color-border)]/65 bg-[var(--color-surface-container-lowest)] shadow-[0_0_0_2px_var(--color-surface)]" />
                </div>
                <AgentCallCard
                  toolCall={toolCall}
                  resultMap={resultMap}
                  childToolCallsByParent={childToolCallsByParent}
                  agentTaskNotification={agentTaskNotifications[toolCall.toolUseId]}
                  isStreaming={isStreaming && !resultMap.has(toolCall.toolUseId)}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Separated so the useState hook is never called conditionally. */
function ToolCallGroupMulti({ toolCalls, resultMap, childToolCallsByParent, isStreaming }: Props) {
  const [expanded, setExpanded] = useState(false)
  const t = useTranslation()
  const summary = generateSummary(toolCalls, t)
  const errorPresent = groupHasErrors(toolCalls, resultMap)
  const allComplete = toolCalls.every((tc) => resultMap.has(tc.toolUseId))
  const hasNestedToolCalls = toolCalls.some((tc) => (childToolCallsByParent.get(tc.toolUseId)?.length ?? 0) > 0)

  useEffect(() => {
    if (isStreaming || hasNestedToolCalls) {
      setExpanded(true)
    }
  }, [hasNestedToolCalls, isStreaming])

  const isExecuting =
    Boolean(isStreaming) &&
    toolCalls.some((toolCall) => isToolCallRunning(toolCall, resultMap, childToolCallsByParent))

  return (
    <div
      data-running={isExecuting ? 'true' : undefined}
      className={`mb-2 overflow-hidden rounded-[var(--radius-lg)] bg-[var(--color-surface-container)] ${isExecuting ? 'tool-running-sweep' : ''}`}
    >
      {/* Left accent line + header */}
      <div className="flex">
        <div className={`w-0.5 shrink-0 ${isExecuting ? 'bg-[var(--color-brand)] animate-accent-pulse-line' : 'bg-[var(--color-brand)]'}`} />
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex flex-1 items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-[var(--color-surface-hover)]/50"
        >
          <Icon name={expanded ? 'expand_less' : 'expand_more'} size={14} className="text-[var(--color-outline)] transition-transform duration-200" style={{ transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)' }} />
          <span className={`flex-1 truncate text-[12px] text-[var(--color-text-secondary)] ${isExecuting ? 'tool-running-text' : ''}`}>
            {summary}
          </span>
          <span className={`label-micro text-[var(--color-text-tertiary)] ${isExecuting ? 'tool-running-text' : ''}`}>
            {toolCalls.length}
          </span>
          {!isExecuting && allComplete && !errorPresent && (
            <Icon name="check_circle" size={14} className="text-[var(--color-success)]" />
          )}
          {!isExecuting && errorPresent && (
            <Icon name="error" size={14} className="text-[var(--color-error)]" />
          )}
          {!isExecuting && !allComplete && !errorPresent && (
            <span className="flex" title={t('agentStatus.stopped')}>
              <Icon
                name="stop_circle"
                size={14}
                className="text-[var(--color-outline)]"
              />
            </span>
          )}
          {isExecuting && (
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-brand)] animate-pulse-dot" />
          )}
        </button>
      </div>

      {expanded && (
        <div
          className="space-y-0 px-3 pb-2"
          style={{ animation: 'fade-in 200ms cubic-bezier(0.16, 1, 0.3, 1)' }}
        >
          {toolCalls.map((tc, idx) => {
            const isLast = idx === toolCalls.length - 1
            return (
              <div key={tc.id} className={isLast ? '' : 'border-b border-[var(--color-border-separator)]'}>
                <ToolCallTree
                  toolCall={tc}
                  resultMap={resultMap}
                  childToolCallsByParent={childToolCallsByParent}
                  isActive={Boolean(isStreaming)}
                  compact
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function AgentCallCard({
  toolCall,
  resultMap,
  childToolCallsByParent,
  agentTaskNotification,
  isStreaming = false,
}: {
  toolCall: ToolCall
  resultMap: Map<string, ToolResult>
  childToolCallsByParent: Map<string, ToolCall[]>
  agentTaskNotification?: AgentTaskNotification
  isStreaming?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const t = useTranslation()
  const input = toolCall.input && typeof toolCall.input === 'object'
    ? toolCall.input as Record<string, unknown>
    : {}
  const result = resultMap.get(toolCall.toolUseId)
  const childToolCalls = childToolCallsByParent.get(toolCall.toolUseId) ?? []
  const isLaunchResult = isAgentLaunchResult(result?.content)
  const recentToolCalls = childToolCalls.slice(-2)
  const status = getAgentStatus({
    hasResult: !!result,
    isError: !!result?.isError,
    isLaunchResult,
    isStreaming,
    childCount: childToolCalls.length,
    taskStatus: agentTaskNotification?.status,
  })
  const statusClassName = getAgentStatusClassName(status)
  const statusLabel = getAgentStatusLabel(status, t)
  const taskSummary = agentTaskNotification?.summary?.trim() || ''
  const errorText =
    status === 'failed'
      ? taskSummary || (result?.isError ? getAgentErrorSummary(result.content) : '')
      : result?.isError
        ? getAgentErrorSummary(result.content)
        : ''
  const fullOutputText =
    result && !result.isError && !isLaunchResult && !isAgentLifecycleResult(result.content)
      ? extractAgentDisplayText(result.content).trim()
      : ''
  const previewText = fullOutputText || (status === 'done' || status === 'stopped' ? taskSummary : '')
  const outputSummary = previewText ? getAgentOutputSummary(previewText) : ''
  const description = typeof input.description === 'string' ? input.description : ''

  const isRunning = status === 'starting' || status === 'running'

  return (
    <div
      data-running={isRunning ? 'true' : undefined}
      className={`overflow-hidden rounded-lg bg-[var(--color-surface-container-low)] ${isRunning ? 'tool-running-sweep' : ''}`}
    >
      <div className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--color-surface-hover)]/50">
        <Icon name="smart_toy" size={18} className="text-[var(--color-brand)]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`label-micro text-[var(--color-brand)] ${isRunning ? 'tool-running-text' : ''}`}>Agent</span>
            {description && (
              <span className={`truncate text-[12px] text-[var(--color-text-secondary)] ${isRunning ? 'tool-running-text' : ''}`}>
                {description}
              </span>
            )}
          </div>
          {!expanded && outputSummary && (
            <div className="mt-1 line-clamp-2 text-[11px] text-[var(--color-text-tertiary)]">
              {outputSummary}
            </div>
          )}
          {!expanded && !outputSummary && recentToolCalls.length > 0 && (
            <div className="mt-1 space-y-1">
              {recentToolCalls.map((recentToolCall) => (
                <div
                  key={recentToolCall.id}
                  className={`truncate text-[11px] text-[var(--color-text-tertiary)] ${isRunning ? 'tool-running-text' : ''}`}
                >
                  {formatRecentToolUseSummary(recentToolCall, resultMap, isRunning)}
                </div>
              ))}
            </div>
          )}
          {!expanded && !outputSummary && !recentToolCalls.length && errorText && (
            <div className="mt-1 truncate text-[11px] text-[var(--color-error)]">
              {errorText}
            </div>
          )}
        </div>
        {outputSummary && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              setPreviewOpen(true)
            }}
            className="btn-ghost px-2.5 py-1 text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-brand)]"
          >
            {t('agentStatus.viewResult')}
          </button>
        )}
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusClassName} ${isRunning ? 'tool-running-text' : ''}`}>
          {statusLabel}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="btn-ghost flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--color-outline)] hover:text-[var(--color-brand)]"
          aria-label={expanded ? 'Collapse agent' : 'Expand agent'}
        >
          <Icon name={expanded ? 'expand_less' : 'expand_more'} size={16} />
        </button>
      </div>

      {expanded && (
        <div
          className="border-t border-[var(--color-border-separator)] px-3 py-3"
          style={{ animation: 'fade-in 200ms cubic-bezier(0.16, 1, 0.3, 1)' }}
        >
          {errorText && (
            <div className="mb-3 rounded-lg bg-[var(--color-error-container)]/60 px-3 py-2 text-[11px] text-[var(--color-error)]">
              {errorText}
            </div>
          )}
          {childToolCalls.length > 0 ? (
            <div className="space-y-1">
              {childToolCalls.map((childToolCall) => (
                <ToolCallTree
                  key={childToolCall.id}
                  toolCall={childToolCall}
                  resultMap={resultMap}
                  childToolCallsByParent={childToolCallsByParent}
                  isActive={isRunning}
                  compact
                />
              ))}
            </div>
          ) : outputSummary ? (
            <div className="text-[11px] text-[var(--color-text-tertiary)]">
              {t('agentStatus.noActivity')}
            </div>
          ) : (
            <div className="text-[11px] text-[var(--color-text-tertiary)]">
              {status === 'starting' ? t('agentStatus.starting') : t('agentStatus.noActivity')}
            </div>
          )}
        </div>
      )}
      <Modal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title={description || t('agentStatus.resultTitle')}
        width={900}
      >
        <div className="max-h-[70vh] overflow-y-auto">
          <MarkdownRenderer content={previewText || errorText} />
        </div>
      </Modal>
    </div>
  )
}

function ToolCallTree({
  toolCall,
  resultMap,
  childToolCallsByParent,
  isActive = true,
  compact = false,
}: {
  toolCall: ToolCall
  resultMap: Map<string, ToolResult>
  childToolCallsByParent: Map<string, ToolCall[]>
  isActive?: boolean
  compact?: boolean
}) {
  const result = resultMap.get(toolCall.toolUseId)
  const childToolCalls = childToolCallsByParent.get(toolCall.toolUseId) ?? []
  const isRunning =
    isActive &&
    isToolCallRunning(toolCall, resultMap, childToolCallsByParent)

  return (
    <div className={compact ? 'space-y-1' : ''}>
      <ToolCallBlock
        toolName={toolCall.toolName}
        input={toolCall.input}
        result={result ? { content: result.content, isError: result.isError } : null}
        compact={compact}
        running={isRunning}
      />
      {childToolCalls.length > 0 && (
        <div className={compact ? 'ml-4 border-l border-[var(--color-border-separator)] pl-3' : 'mb-2 ml-16 border-l border-[var(--color-border-separator)] pl-3'}>
          <div className="space-y-1">
            {childToolCalls.map((childToolCall) => (
              <ToolCallTree
                key={childToolCall.id}
                toolCall={childToolCall}
                resultMap={resultMap}
                childToolCallsByParent={childToolCallsByParent}
                isActive={isActive}
                compact
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function isToolCallRunning(
  toolCall: ToolCall,
  resultMap: Map<string, ToolResult>,
  childToolCallsByParent: Map<string, ToolCall[]>,
): boolean {
  if (!resultMap.has(toolCall.toolUseId)) return true

  const childToolCalls = childToolCallsByParent.get(toolCall.toolUseId) ?? []
  return childToolCalls.some((childToolCall) =>
    isToolCallRunning(childToolCall, resultMap, childToolCallsByParent)
  )
}

type AgentStatus = 'starting' | 'running' | 'done' | 'failed' | 'stopped'
type AgentTaskStatus = AgentTaskNotification['status']

function getAgentStatus({
  hasResult,
  isError,
  isLaunchResult,
  isStreaming,
  childCount,
  taskStatus,
}: {
  hasResult: boolean
  isError: boolean
  isLaunchResult: boolean
  isStreaming: boolean
  childCount: number
  taskStatus?: AgentTaskStatus
}): AgentStatus {
  if (taskStatus === 'failed') return 'failed'
  if (taskStatus === 'stopped') return 'stopped'
  if (taskStatus === 'completed') return 'done'
  if (hasResult && isError && !isLaunchResult) return 'failed'
  if (hasResult && !isLaunchResult) return 'done'
  if (isLaunchResult) return 'running'
  if (!isStreaming) return 'stopped'
  if (childCount > 0 || isStreaming) return 'running'
  return 'starting'
}

function getAgentStatusLabel(
  status: AgentStatus,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  switch (status) {
    case 'failed':
      return t('agentStatus.failed')
    case 'stopped':
      return t('agentStatus.stopped')
    case 'done':
      return t('agentStatus.done')
    case 'running':
      return t('agentStatus.running')
    case 'starting':
    default:
      return t('agentStatus.starting')
  }
}

function getAgentStatusClassName(status: AgentStatus): string {
  switch (status) {
    case 'failed':
      return 'bg-[var(--color-error)]/10 text-[var(--color-error)]'
    case 'stopped':
      return 'bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]'
    case 'done':
      return 'bg-[var(--color-success)]/10 text-[var(--color-success)]'
    case 'running':
      return 'bg-[var(--color-brand)]/10 text-[var(--color-brand)]'
    case 'starting':
    default:
      return 'bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]'
  }
}

function formatRecentToolUseSummary(
  toolCall: ToolCall,
  resultMap: Map<string, ToolResult>,
  isActive: boolean,
): string {
  const input = toolCall.input && typeof toolCall.input === 'object'
    ? toolCall.input as Record<string, unknown>
    : {}
  const result = resultMap.get(toolCall.toolUseId)
  const suffix = result?.isError
    ? ' * failed'
    : result
      ? ' * done'
      : isActive
        ? ' * running'
        : ' * stopped'

  switch (toolCall.toolName) {
    case 'Bash':
      return `Bash · ${typeof input.command === 'string' ? input.command : ''}${suffix}`
    case 'Read':
      return `Read · ${typeof input.file_path === 'string' ? input.file_path.split('/').pop() : 'file'}${suffix}`
    case 'Glob':
      return `Glob · ${typeof input.pattern === 'string' ? input.pattern : ''}${suffix}`
    case 'Grep':
      return `Grep · ${typeof input.pattern === 'string' ? input.pattern : ''}${suffix}`
    case 'CodeGraph':
      return `CodeGraph · ${typeof input.query === 'string' ? input.query : input.action ?? 'status'}${suffix}`
    case 'Agent':
      return `Agent · ${typeof input.description === 'string' ? input.description : ''}${suffix}`
    default:
      return `${toolCall.toolName}${suffix}`
  }
}

function getAgentErrorSummary(content: unknown): string {
  const text = extractTextContent(content).replace(/\s+/g, ' ').trim()
  if (!text) return ''
  if (text.includes(`Agent type 'Explore' not found`)) {
    return 'Explore agent unavailable in this session'
  }
  return text.length > 120 ? `${text.slice(0, 120)}...` : text
}

function getAgentOutputSummary(content: string): string {
  const text = content.replace(/\s+\n/g, '\n').trim()
  if (!text) return ''
  return text.length > 220 ? `${text.slice(0, 220)}...` : text
}

function extractAgentDisplayText(content: unknown): string {
  return stripAgentResultMetadata(extractTextContent(content))
}

function stripAgentResultMetadata(text: string): string {
  return text
    .replace(/^\s*agentId:.*(?:\r?\n)?/gm, '')
    .replace(/<usage>[\s\S]*?<\/usage>/g, '')
    .replace(/^\s*(?:total_tokens|tool_uses|duration_ms):\s*\d+\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function isAgentLaunchResult(content: unknown): boolean {
  const text = extractTextContent(content).trim()
  if (!text) return false

  return (
    text.startsWith('Async agent launched successfully.') ||
    text.startsWith('Remote agent launched in CCR.') ||
    (text.startsWith('Spawned successfully.') &&
      text.includes('The agent is now running and will receive instructions via mailbox.')) ||
    text.includes('The agent is working in the background. You will be notified automatically when it completes.') ||
    text.includes('The agent is running remotely. You will be notified automatically when it completes.')
  )
}

/**
 * Check if agent result content is a lifecycle notification (shutdown, terminated, etc.)
 * rather than actual agent output. These should not be shown to the user as results.
 */
function isAgentLifecycleResult(content: unknown): boolean {
  const text = extractTextContent(content).trim()
  if (!text) return false
  // Detect JSON lifecycle messages: shutdown_approved, shutdown_rejected, teammate_terminated
  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      if (typeof parsed.type === 'string' && AGENT_LIFECYCLE_TYPES.has(parsed.type)) {
        return true
      }
    } catch {
      // Not valid JSON, not a lifecycle message
    }
  }
  return false
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((chunk) => {
        if (typeof chunk === 'string') return chunk
        if (chunk && typeof chunk === 'object' && 'text' in chunk) {
          return typeof chunk.text === 'string' ? chunk.text : ''
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (content && typeof content === 'object') {
    if (
      'status' in content &&
      (content as Record<string, unknown>).status === 'completed' &&
      Array.isArray((content as Record<string, unknown>).content)
    ) {
      return extractTextContent((content as Record<string, unknown>).content)
    }
    }
  if (content && typeof content === 'object') {
    return JSON.stringify(content)
  }
  return ''
}
