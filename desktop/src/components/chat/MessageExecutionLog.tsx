import { useState } from 'react'
import type { UIMessage } from '../../types/chat'
import { Icon } from '../shared/Icon'
import { ToolCallBlock } from './ToolCallBlock'

type ToolCall = Extract<UIMessage, { type: 'tool_use' }>
type ToolResult = Extract<UIMessage, { type: 'tool_result' }>

type Props = {
  toolCalls: ToolCall[]
  resultMap: Map<string, ToolResult>
}

export function MessageExecutionLog({ toolCalls, resultMap }: Props) {
  if (toolCalls.length === 0) return null

  return (
    <div className="mt-1.5 min-w-full max-h-[150px] overflow-y-auto rounded-[10px] bg-[var(--color-surface-container-low)] px-2.5 py-1 mb-3"
      style={{ scrollbarWidth: 'thin' }}
    >
      {toolCalls.map((tc) => (
        <ExecutionLogItem key={tc.id} toolCall={tc} result={resultMap.get(tc.toolUseId)} />
      ))}
    </div>
  )
}

function ExecutionLogItem({ toolCall, result }: { toolCall: ToolCall; result?: ToolResult }) {
  const [expanded, setExpanded] = useState(false)
  const isDone = !!result
  const isError = result?.isError ?? false
  const info = getToolInfo(toolCall)

  return (
    <div className="border-b border-[var(--color-border-separator)] last:border-0"
      style={{ animation: 'fadeInUp 250ms cubic-bezier(0.16, 1, 0.3, 1)' }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1.5 py-[3px] text-left group/row"
      >
        {/* Status indicator — tiny dot */}
        <span className="w-1.5 h-1.5 rounded-full shrink-0 transition-colors"
          style={{
            backgroundColor: !isDone ? 'var(--color-brand)' : isError ? 'var(--color-error)' : '#28c840',
            opacity: !isDone ? 1 : 0.7,
          }}
        />

        {/* Tool icon — minimal SVG */}
        <span className="shrink-0 text-[var(--color-text-tertiary)] opacity-50 group-hover/row:opacity-80 transition-opacity">
          <Icon name={info.icon} size={12} />
        </span>

        {/* Label + brief */}
        <span className="text-[11px] text-[var(--color-text-tertiary)] truncate flex-1 leading-relaxed">
          <span className="font-medium text-[var(--color-text-secondary)]">{info.label}</span>
          {info.brief && <span className="ml-1.5 opacity-70">{info.brief}</span>}
        </span>

        {/* Chevron */}
        <Icon
          name="expand_more"
          size={10}
          className="shrink-0 text-[var(--color-text-tertiary)] transition-transform duration-150"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>

      {expanded && (
        <div className="pb-2 pl-5"
          style={{ animation: 'fade-in 150ms cubic-bezier(0.16, 1, 0.3, 1)' }}
        >
          <ToolCallBlock
            toolName={toolCall.toolName}
            input={toolCall.input}
            result={result ? { content: result.content, isError: result.isError } : null}
            compact
          />
        </div>
      )}
    </div>
  )
}

function getToolInfo(tc: ToolCall) {
  const input = tc.input && typeof tc.input === 'object' ? tc.input as Record<string, unknown> : {}
  const brief = typeof input.file_path === 'string'
    ? input.file_path.split('/').pop() ?? ''
    : typeof input.command === 'string'
      ? input.command.slice(0, 35)
      : typeof input.description === 'string'
        ? input.description.slice(0, 35)
        : typeof input.pattern === 'string'
          ? input.pattern
          : ''

  switch (tc.toolName) {
    case 'Read':
      return { label: 'Read', brief, icon: 'visibility' }
    case 'Write':
      return { label: 'Write', brief, icon: 'edit' }
    case 'Edit':
      return { label: 'Edit', brief, icon: 'edit' }
    case 'Bash':
      return { label: 'Run', brief, icon: 'terminal' }
    case 'Glob':
      return { label: 'Find', brief, icon: 'search' }
    case 'Grep':
      return { label: 'Search', brief, icon: 'search' }
    case 'Agent':
      return { label: 'Agent', brief, icon: 'smart_toy' }
    case 'WebSearch':
      return { label: 'Web', brief, icon: 'travel_explore' }
    case 'WebFetch':
      return { label: 'Fetch', brief, icon: 'travel_explore' }
    default:
      return { label: tc.toolName, brief, icon: 'code' }
  }
}
