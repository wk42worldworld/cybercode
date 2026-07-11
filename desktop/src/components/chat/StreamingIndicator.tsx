import { useEffect, useRef, useState } from 'react'
import { isSpinnerVerb } from '../../config/spinnerVerbs'
import { getSpinnerVerbTranslation } from '../../config/spinnerVerbTranslations'
import { useTranslation } from '../../i18n'
import type { TranslationKey } from '../../i18n/locales/en'
import { useChatStore } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
import type { ChatState } from '../../types/chat'
import type { Locale } from '../../i18n/localeConfig'

function formatElapsed(seconds: number, locale: Locale): string {
  if (seconds < 60) {
    if (locale === 'zh' || locale === 'ja') return `${seconds}秒`
    if (locale === 'ko') return `${seconds}초`
    return `${seconds}s`
  }
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (locale === 'zh' || locale === 'ja') return `${m}分 ${s}秒`
  if (locale === 'ko') return `${m}분 ${s}초`
  return `${m}m ${s}s`
}

const SERVER_VERB_KEYS: Record<string, TranslationKey> = {
  Thinking: 'serverVerb.Thinking',
  'Task started': 'serverVerb.Task started',
  'Task in progress': 'serverVerb.Task in progress',
  'Switching provider and model...': 'serverVerb.Switching provider and model',
  'Restarting session with new permissions...': 'serverVerb.Restarting session with new permissions',
}

const LOCALIZED_SPINNER_KEYS: TranslationKey[] = [
  'streaming.preparing',
  'streaming.analyzing',
  'streaming.organizing',
  'streaming.planning',
  'streaming.reasoning',
  'streaming.composing',
  'streaming.processing',
  'streaming.exploring',
]

function stableIndex(value: string, length: number): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash) % length
}

function fallbackVerbKey(chatState: ChatState): TranslationKey {
  if (chatState === 'thinking') return 'streaming.thinking'
  if (chatState === 'tool_executing') return 'streaming.running'
  return 'streaming.working'
}

export function resolveStreamingVerb(
  statusVerb: string,
  chatState: ChatState,
  locale: Locale,
  translate: (key: TranslationKey) => string,
): string {
  if (!statusVerb) return translate(fallbackVerbKey(chatState))

  const serverVerbKey = SERVER_VERB_KEYS[statusVerb]
  if (serverVerbKey) return translate(serverVerbKey)
  if (locale === 'en') return statusVerb

  if (isSpinnerVerb(statusVerb)) {
    const translatedVerb = getSpinnerVerbTranslation(statusVerb, locale)
    if (translatedVerb) return translatedVerb
    return translate(LOCALIZED_SPINNER_KEYS[stableIndex(statusVerb, LOCALIZED_SPINNER_KEYS.length)]!)
  }

  return translate(fallbackVerbKey(chatState))
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
  const t = useTranslation()
  const locale = useSettingsStore((state) => state.locale)
  const globalActiveTabId = useTabStore((s) => s.activeTabId)
  const activeTabId = sessionId ?? globalActiveTabId
  const sessionState = useChatStore((s) => activeTabId ? s.sessions[activeTabId] : undefined)
  const chatState = sessionState?.chatState ?? 'idle'
  const statusVerb = sessionState?.statusVerb ?? ''
  const elapsedSeconds = sessionState?.elapsedSeconds ?? 0
  const tokenUsage = sessionState?.tokenUsage ?? { input_tokens: 0, output_tokens: 0 }

  const animatedTokens = useAnimatedNumber(tokenUsage.output_tokens, 600)

  if (chatState === 'idle') return null

  const verb = resolveStreamingVerb(statusVerb, chatState, locale, t)

  return (
    <div
      data-testid="streaming-indicator"
      role="status"
      aria-label={verb}
      className="ai-response-status flex h-[56px] w-full shrink-0 justify-center overflow-hidden px-[24px] py-[8px]"
    >
      <div className="flex h-[40px] w-full max-w-[878px] items-center gap-2 overflow-hidden px-[20px]">
        <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
          <span className="breathing-dot-ring absolute inline-flex h-full w-full rounded-full bg-[var(--color-brand)] opacity-30" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-brand)]" />
        </span>

        <span data-testid="streaming-verb" className="ai-shimmer-text inline-flex h-[18px] min-w-0 items-center truncate whitespace-nowrap text-[12px] font-medium leading-[18px]">
          {verb}
        </span>

        <span
          data-testid="streaming-elapsed"
          aria-hidden="true"
          className={`ai-shimmer-text ai-shimmer-muted inline-flex h-[18px] w-[76px] shrink-0 items-center whitespace-nowrap text-[12px] font-medium leading-[18px] tabular-nums ${elapsedSeconds > 0 ? '' : 'invisible'}`}
        >
          {formatElapsed(elapsedSeconds, locale)}
        </span>

        <span
          data-testid="streaming-token-count"
          aria-hidden="true"
          className={`ai-shimmer-text ai-shimmer-muted inline-flex h-[18px] w-[72px] shrink-0 items-center whitespace-nowrap text-[12px] font-medium leading-[18px] tabular-nums ${tokenUsage.output_tokens > 0 ? '' : 'invisible'}`}
        >
          · {animatedTokens}
        </span>
      </div>
    </div>
  )
}
