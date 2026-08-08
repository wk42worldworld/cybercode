import { useEffect, useState } from 'react'
import { ToolCallBlock } from './ToolCallBlock'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { Modal } from '../shared/Modal'
import { useTranslation } from '../../i18n'
import type { TranslationKey } from '../../i18n'
import type { AgentTaskNotification, UIMessage } from '../../types/chat'
import { AGENT_LIFECYCLE_TYPES } from '../../types/team'
import { isAgentLaunchResult } from '../../utils/toolCallState'
import { Icon } from '../shared/Icon'

type ToolCall = Extract<UIMessage, { type: 'tool_use' }>
type ToolResult = Extract<UIMessage, { type: 'tool_result' }>

type Props = {
  toolCalls: ToolCall[]
  resultMap: Map<string, ToolResult>
  childToolCallsByParent: Map<string, ToolCall[]>
  agentTaskNotifications: Record<string, AgentTaskNotification>
  /** When true, a tool is executing and receives the live progress treatment. */
  isStreaming?: boolean
  /** Keeps the group expanded until the entire assistant turn finishes. */
  isTurnActive?: boolean
}

const READ_TOOL_NAMES = new Set(['read'])
const COMMAND_TOOL_NAMES = new Set(['bash'])
const MODIFY_TOOL_NAMES = new Set(['edit', 'write', 'notebookedit', 'multiedit'])

function normalizedToolName(toolName: string): string {
  return toolName.replace(/[^a-z]/gi, '').toLowerCase()
}

function getToolFilePath(toolCall: ToolCall): string {
  const input = toolCall.input && typeof toolCall.input === 'object'
    ? toolCall.input as Record<string, unknown>
    : {}
  const filePath = input.file_path ?? input.notebook_path ?? input.path
  return typeof filePath === 'string' ? filePath.trim() : ''
}

function flattenToolCalls(
  rootToolCalls: ToolCall[],
  childToolCallsByParent: Map<string, ToolCall[]>,
): ToolCall[] {
  const flattened: ToolCall[] = []
  const visited = new Set<string>()

  const visit = (toolCall: ToolCall) => {
    if (visited.has(toolCall.toolUseId)) return
    visited.add(toolCall.toolUseId)
    flattened.push(toolCall)
    for (const child of childToolCallsByParent.get(toolCall.toolUseId) ?? []) {
      visit(child)
    }
  }

  rootToolCalls.forEach(visit)
  return flattened
}

function countDistinctFileOperations(toolCalls: ToolCall[], toolNames: Set<string>): number {
  const filePaths = new Set<string>()
  let callsWithoutPath = 0

  for (const toolCall of toolCalls) {
    if (!toolNames.has(normalizedToolName(toolCall.toolName))) continue
    const filePath = getToolFilePath(toolCall)
    if (filePath) {
      filePaths.add(filePath)
    } else {
      callsWithoutPath += 1
    }
  }

  return filePaths.size + callsWithoutPath
}

function getActivityCounts(
  rootToolCalls: ToolCall[],
  childToolCallsByParent: Map<string, ToolCall[]>,
) {
  const toolCalls = flattenToolCalls(rootToolCalls, childToolCallsByParent)
  return {
    toolCalls,
    filesRead: countDistinctFileOperations(toolCalls, READ_TOOL_NAMES),
    commandsRun: toolCalls.filter((toolCall) =>
      COMMAND_TOOL_NAMES.has(normalizedToolName(toolCall.toolName))
    ).length,
    filesModified: countDistinctFileOperations(toolCalls, MODIFY_TOOL_NAMES),
  }
}

function groupHasErrors(toolCalls: ToolCall[], resultMap: Map<string, ToolResult>): boolean {
  return toolCalls.some((toolCall) => resultMap.get(toolCall.toolUseId)?.isError)
}

export function ToolCallGroup({
  toolCalls,
  resultMap,
  childToolCallsByParent,
  agentTaskNotifications,
  isStreaming = true,
  isTurnActive = false,
}: Props) {
  return (
    <UnifiedToolGroup
      toolCalls={toolCalls}
      resultMap={resultMap}
      childToolCallsByParent={childToolCallsByParent}
      agentTaskNotifications={agentTaskNotifications}
      isStreaming={isStreaming}
      isTurnActive={isTurnActive}
    />
  )
}

/**
 * Unified tool-call presentation: one container style for 1..N tools.
 * Stays expanded for the entire live assistant turn, then auto-collapses to a
 * single summary line. The tool execution state only controls live styling.
 */
function UnifiedToolGroup({
  toolCalls,
  resultMap,
  childToolCallsByParent,
  agentTaskNotifications,
  isStreaming,
  isTurnActive,
}: Props) {
  const t = useTranslation()
  const [manualOverride, setManualOverride] = useState<boolean | null>(null)
  const { toolCalls: allToolCalls, filesRead, commandsRun, filesModified } =
    getActivityCounts(toolCalls, childToolCallsByParent)
  const hasRunningAgent = allToolCalls.some((toolCall) => {
    if (normalizedToolName(toolCall.toolName) !== 'agent') return false
    const result = resultMap.get(toolCall.toolUseId)
    const status = getAgentStatus({
      hasResult: Boolean(result),
      isError: Boolean(result?.isError),
      isLaunchResult: isAgentLaunchResult(result?.content),
      isStreaming: Boolean(isStreaming) && !result,
      childCount: childToolCallsByParent.get(toolCall.toolUseId)?.length ?? 0,
      taskStatus: agentTaskNotifications[toolCall.toolUseId]?.status,
    })
    return status === 'starting' || status === 'running'
  })
  const isExecuting = Boolean(isStreaming) || hasRunningAgent
  const expanded = Boolean(isTurnActive) || (manualOverride ?? isExecuting)

  // Each new turn starts from the automatic expanded state. While that turn is
  // active, individual tool waves must not collapse the activity history.
  useEffect(() => {
    if (isTurnActive) setManualOverride(null)
  }, [isTurnActive])

  const allComplete = allToolCalls.every((toolCall) => resultMap.has(toolCall.toolUseId))
  const errorPresent = groupHasErrors(allToolCalls, resultMap)
  const isInterrupted = !isExecuting && !allComplete
  const summaryParts = [
    t(
      allToolCalls.length === 1
        ? 'toolGroup.activityToolsOne'
        : 'toolGroup.activityToolsMany',
      { count: allToolCalls.length },
    ),
  ]
  if (filesRead > 0) {
    summaryParts.push(t(
      filesRead === 1 ? 'toolGroup.activityReadOne' : 'toolGroup.activityReadMany',
      { count: filesRead },
    ))
  }
  if (commandsRun > 0) {
    summaryParts.push(t(
      commandsRun === 1 ? 'toolGroup.activityCommandsOne' : 'toolGroup.activityCommandsMany',
      { count: commandsRun },
    ))
  }
  if (filesModified > 0) {
    summaryParts.push(t(
      filesModified === 1 ? 'toolGroup.activityModifiedOne' : 'toolGroup.activityModifiedMany',
      { count: filesModified },
    ))
  }
  const summary = summaryParts.join(' · ')

  return (
    <div className="flex w-full justify-center">
      <div
        data-tool-activity-container
        data-layout={expanded ? 'expanded' : 'collapsed'}
        data-running={isExecuting ? 'true' : undefined}
        data-interrupted={isInterrupted ? 'true' : undefined}
        className={`w-full overflow-hidden rounded-[24px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] text-[var(--color-text-primary)] ${isExecuting ? 'tool-running-sweep' : ''}`}
      >
      <button
        type="button"
        aria-expanded={expanded}
        aria-disabled={isTurnActive ? 'true' : undefined}
        onClick={() => {
          if (!isTurnActive) setManualOverride(!expanded)
        }}
        className="flex h-[44px] w-full items-center justify-center gap-[8px] px-[16px] text-center transition-colors hover:bg-[var(--color-surface-hover)]/45"
      >
        <span
          data-tool-activity-status
          className="flex h-4 w-4 shrink-0 items-center justify-center"
        >
          {!isExecuting && allComplete && !errorPresent && (
            <Icon name="check_circle" size={15} className="text-[var(--color-success)]" />
          )}
          {!isExecuting && errorPresent && (
            <Icon name="error" size={15} className="text-[var(--color-error)]" />
          )}
          {!isExecuting && !allComplete && !errorPresent && (
            <span className="flex" title={t('agentStatus.stopped')}>
              <Icon name="stop_circle" size={15} className="text-[var(--color-outline)]" />
            </span>
          )}
          {isExecuting && (
            <span
              data-tool-activity-status-dot
              className="h-2 w-2 rounded-full bg-[var(--color-brand)] animate-pulse-dot"
            />
          )}
        </span>
        <span
          data-tool-activity-summary
          className={`min-w-0 flex-1 truncate text-center text-[12px] font-semibold leading-none text-[var(--color-text-secondary)] ${isExecuting ? 'tool-running-text' : ''}`}
        >
          {summary}
        </span>
        <span
          data-tool-activity-disclosure
          className="flex h-4 w-4 shrink-0 items-center justify-center"
        >
          <Icon
            name={expanded ? 'expand_less' : 'expand_more'}
            size={16}
            className="text-[var(--color-outline)] transition-transform duration-200"
            style={{ transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)' }}
          />
        </span>
      </button>

      {expanded && (
        <div
          data-tool-activity-details
          className="scrollbar-no-track max-h-[284px] space-y-2 overflow-y-auto border-t border-[var(--color-border-separator)]/45 px-4 py-3"
          style={{ animation: 'fade-in 200ms cubic-bezier(0.16, 1, 0.3, 1)' }}
        >
          {toolCalls.map((toolCall) => (
            toolCall.toolName === 'Agent' ? (
              <AgentCallCard
                key={toolCall.id}
                toolCall={toolCall}
                resultMap={resultMap}
                childToolCallsByParent={childToolCallsByParent}
                agentTaskNotification={agentTaskNotifications[toolCall.toolUseId]}
                isStreaming={isExecuting && !resultMap.has(toolCall.toolUseId)}
              />
            ) : (
              <div key={toolCall.id}>
                <ToolCallTree
                  toolCall={toolCall}
                  resultMap={resultMap}
                  childToolCallsByParent={childToolCallsByParent}
                  isActive={isExecuting}
                  compact
                />
              </div>
            )
          ))}
        </div>
      )}
      </div>
    </div>
  )
}

/** Separated so the useState hook is never called conditionally. */
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
        <div className={compact ? 'ml-3 mt-1' : 'mb-2 ml-12 mt-1'}>
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
