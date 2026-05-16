import { useEffect, useRef, useState } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

function useAnimatedNumber(target: number, duration = 800) {
  const [display, setDisplay] = useState(0)
  const startRef = useRef(0)
  const fromRef = useRef(0)
  const toRef = useRef(target)

  useEffect(() => {
    if (target === display) return
    fromRef.current = display
    toRef.current = target
    startRef.current = performance.now()

    let raf: number
    const tick = (now: number) => {
      const elapsed = now - startRef.current
      const progress = Math.min(elapsed / duration, 1)
      // easeOutCubic
      const eased = 1 - Math.pow(1 - progress, 3)
      const value = Math.round(fromRef.current + (toRef.current - fromRef.current) * eased)
      setDisplay(value)
      if (progress < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])

  return display
}

type StreamingIndicatorProps = {
  sessionId?: string
}

export function StreamingIndicator({ sessionId }: StreamingIndicatorProps = {}) {
  const globalActiveTabId = useTabStore((s) => s.activeTabId)
  const activeTabId = sessionId ?? globalActiveTabId
  const sessionState = useChatStore((s) => activeTabId ? s.sessions[activeTabId] : undefined)
  const chatState = sessionState?.chatState ?? 'idle'
  const statusVerb = sessionState?.statusVerb ?? ''
  const elapsedSeconds = sessionState?.elapsedSeconds ?? 0
  const tokenUsage = sessionState?.tokenUsage ?? { input_tokens: 0, output_tokens: 0 }

  const animatedTokens = useAnimatedNumber(tokenUsage.output_tokens, 600)

  if (chatState === 'idle') return null

  let verb: string
  if (statusVerb) {
    verb = statusVerb
  } else {
    verb = chatState === 'thinking' ? 'Thinking' : chatState === 'tool_executing' ? 'Running' : 'Working'
  }

  return (
    <div className="flex items-center gap-2">
      {/* Breathing dot */}
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        <span className="breathing-dot-ring absolute inline-flex h-full w-full rounded-full bg-[var(--color-brand)] opacity-30" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-brand)]" />
      </span>

      <span className="ai-shimmer-text text-[12px] leading-relaxed font-medium tracking-[-0.01em]">
        {verb}
      </span>

      {elapsedSeconds > 0 && (
        <span className="ai-shimmer-text ai-shimmer-muted text-[12px] leading-relaxed font-mono tabular-nums">
          {formatElapsed(elapsedSeconds)}
        </span>
      )}

      {tokenUsage.output_tokens > 0 && (
        <span className="ai-shimmer-text ai-shimmer-muted text-[12px] leading-relaxed font-mono tabular-nums">
          · {animatedTokens}
        </span>
      )}

      <style>{breathingStyles}</style>
    </div>
  )
}

const breathingStyles = `
@keyframes breathing-dot {
  0%, 100% { transform: scale(1); opacity: 0.3; }
  50% { transform: scale(2.2); opacity: 0; }
}
.breathing-dot-ring {
  animation: breathing-dot 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
`
