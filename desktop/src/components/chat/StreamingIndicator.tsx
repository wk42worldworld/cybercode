import { useChatStore } from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

export function StreamingIndicator() {
  const activeTabId = useTabStore((s) => s.activeTabId)
  const sessionState = useChatStore((s) => activeTabId ? s.sessions[activeTabId] : undefined)
  const chatState = sessionState?.chatState ?? 'idle'
  const statusVerb = sessionState?.statusVerb ?? ''
  const elapsedSeconds = sessionState?.elapsedSeconds ?? 0
  const tokenUsage = sessionState?.tokenUsage ?? { input_tokens: 0, output_tokens: 0 }
  let verb: string
  if (statusVerb) {
    verb = statusVerb
  } else {
    verb = chatState === 'thinking' ? 'Thinking' : chatState === 'tool_executing' ? 'Running' : 'Working'
  }

  return (
    <div className="mb-3 flex w-fit items-center gap-2 rounded-full border-2 border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 py-1.5">
      <span className="flex gap-1">
        <span className="h-1 w-1 rounded-full bg-[var(--color-spacex-accent)]" style={{ animation: 'bounce-dot 1.2s infinite ease-in-out' }} />
        <span className="h-1 w-1 rounded-full bg-[var(--color-spacex-accent)]" style={{ animation: 'bounce-dot 1.2s infinite ease-in-out -0.15s' }} />
        <span className="h-1 w-1 rounded-full bg-[var(--color-spacex-accent)]" style={{ animation: 'bounce-dot 1.2s infinite ease-in-out -0.30s' }} />
      </span>
      <span className="text-[11px] font-semibold tracking-tight text-[var(--color-text-secondary)]">{verb}…</span>
      {elapsedSeconds > 0 && (
        <span className="font-mono text-[10px] tabular-nums text-[var(--color-text-tertiary)]">
          {formatElapsed(elapsedSeconds)}
        </span>
      )}
      {tokenUsage.output_tokens > 0 && (
        <span className="font-mono text-[10px] tabular-nums text-[var(--color-text-tertiary)]">
          · ↓ {tokenUsage.output_tokens}
        </span>
      )}
    </div>
  )
}
