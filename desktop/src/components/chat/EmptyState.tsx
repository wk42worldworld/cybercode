import { useState } from 'react'

import { useTranslation, type TranslationKey } from '../../i18n'
import { useSessionStore } from '../../stores/sessionStore'
import { useChatStore } from '../../stores/chatStore'
import { useProviderStore } from '../../stores/providerStore'
import { useSessionRuntimeStore, DRAFT_RUNTIME_SELECTION_KEY } from '../../stores/sessionRuntimeStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore } from '../../stores/uiStore'
import { useTabStore } from '../../stores/tabStore'
import { OFFICIAL_DEFAULT_MODEL_ID } from '../../constants/modelCatalog'
import { ChatInput } from './ChatInput'
import type { AttachmentRef } from '../../types/chat'
import { Icon } from '../shared/Icon'

type EmptyStateProps = {
  /** The session this empty state is bound to. Omit for draft (no session yet). */
  sessionId?: string
  /** hero = full mascot + title + composer; minimal = tiny icon + hint (member sessions) */
  variant?: 'hero' | 'minimal'
}

export function EmptyState({ sessionId, variant = 'hero' }: EmptyStateProps) {
  const t = useTranslation()

  if (variant === 'minimal') {
    return <MinimalEmptyState t={t} />
  }

  if (sessionId) {
    return <HeroEmptyStateForSession sessionId={sessionId} t={t} />
  }

  return <HeroEmptyStateForDraft t={t} />
}

// ─── Minimal variant (member sessions) ───────────────────────────────────────

type TranslateFn = (key: TranslationKey, params?: Record<string, string | number>) => string

function MinimalEmptyState({ t }: { t: TranslateFn }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8">
      <Icon name="smart_toy" size={48} className="mb-4 text-[var(--color-text-tertiary)]" />
      <p className="text-[var(--color-text-secondary)]">
        {t('teams.noMessages')}
      </p>
    </div>
  )
}

// ─── Hero variant — existing session (ActiveSession isEmpty) ─────────────────

function HeroEmptyStateForSession({
  sessionId,
  t,
}: {
  sessionId: string
  t: TranslateFn
}) {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center px-6 md:px-12 overflow-y-auto">
      {/* Subtle radial gradient */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse 60% 50% at 50% 45%, var(--color-accent-glow), transparent)',
        }}
        aria-hidden="true"
      />

      <div className="relative w-full max-w-[640px] flex flex-col">
        <HeroBlock t={t} />

        {/* ChatInput hero variant wrapped with accent glow halo */}
        <div className="relative">
          <div
            className="absolute -inset-3 rounded-[14px] pointer-events-none"
            style={{ boxShadow: '0 0 32px 4px var(--color-accent-glow)' }}
            aria-hidden="true"
          />
          <ChatInput sessionId={sessionId} variant="hero" />
        </div>

        <KeyboardHints />
      </div>
    </div>
  )
}

// ─── Hero variant — draft session (EmptySession, no sessionId yet) ──────────

function HeroEmptyStateForDraft({ t }: { t: TranslateFn }) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [workDir, setWorkDir] = useState('')
  const createSession = useSessionStore((state) => state.createSession)
  const sendMessage = useChatStore((state) => state.sendMessage)
  const connectToSession = useChatStore((state) => state.connectToSession)
  const setActiveView = useUIStore((state) => state.setActiveView)
  const addToast = useUIStore((state) => state.addToast)

  const handleSubmit = async (text: string, attachmentPayload: AttachmentRef[]) => {
    if (isSubmitting) return
    setIsSubmitting(true)
    try {
      const settings = useSettingsStore.getState()
      let providerState = useProviderStore.getState()
      if (
        settings.activeProviderName &&
        providerState.providers.length === 0 &&
        !providerState.isLoading
      ) {
        await providerState.fetchProviders()
        providerState = useProviderStore.getState()
      }
      const inferredProviderId = providerState.activeId ?? (
        settings.activeProviderName
          ? providerState.providers.find((provider) => provider.name === settings.activeProviderName)?.id ?? null
          : null
      )
      const draftSelection =
        useSessionRuntimeStore.getState().selections[DRAFT_RUNTIME_SELECTION_KEY]
        ?? {
          providerId: inferredProviderId,
          modelId: settings.currentModel?.id ?? OFFICIAL_DEFAULT_MODEL_ID,
        }
      const newSessionId = await createSession(workDir || undefined)
      useSessionRuntimeStore.getState().setSelection(newSessionId, draftSelection)
      useSessionRuntimeStore.getState().clearSelection(DRAFT_RUNTIME_SELECTION_KEY)
      setActiveView('code')
      const { activeTabId: curTabId } = useTabStore.getState()
      const createdSession = useSessionStore.getState().sessions.find((session) => session.id === newSessionId)
      if (curTabId) {
        useTabStore.getState().replaceTabSession(curTabId, newSessionId, createdSession?.projectPath)
      } else {
        useTabStore.getState().openTab(newSessionId, t('session.untitled'), 'session', createdSession?.projectPath)
      }
      connectToSession(newSessionId, createdSession?.projectPath)
      sendMessage(newSessionId, text, attachmentPayload)
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('empty.failedToCreate'),
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center px-6 md:px-12 overflow-y-auto">
      {/* Subtle radial gradient */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse 60% 50% at 50% 45%, var(--color-accent-glow), transparent)',
        }}
        aria-hidden="true"
      />

      <div className="relative w-full max-w-[640px] flex flex-col">
        <HeroBlock t={t} />

        {/* ChatInput hero variant wrapped with accent glow halo */}
        <div className="relative">
          <div
            className="absolute -inset-3 rounded-[14px] pointer-events-none"
            style={{ boxShadow: '0 0 32px 4px var(--color-accent-glow)' }}
            aria-hidden="true"
          />
          <ChatInput
            variant="hero"
            onSubmit={handleSubmit}
            workDir={workDir}
            onWorkDirChange={setWorkDir}
            runtimeKey={DRAFT_RUNTIME_SELECTION_KEY}
          />
        </div>

        <KeyboardHints />
      </div>
    </div>
  )
}

// ─── Shared sub-components ───────────────────────────────────────────────────

function HeroBlock({ t }: { t: TranslateFn }) {
  return (
    <div className="flex flex-col items-center text-center mb-8">
      {/* Mascot with accent glow ring */}
      <div className="relative mb-5">
        <img src="/app-icon.png" alt="CyberCode" className="h-[88px] w-[88px] rounded-[8px]" />
        <div
          className="absolute -inset-2 rounded-[12px] pointer-events-none"
          style={{ boxShadow: '0 0 24px 4px var(--color-accent-glow)' }}
          aria-hidden="true"
        />
      </div>
      <h1
        className="mb-2 text-[36px] leading-[1.1] tracking-[-0.02em] text-[var(--color-text-primary)]"
        style={{ fontFamily: 'var(--font-headline)', fontWeight: 800 }}
      >
        {t('empty.title')}
      </h1>
      <p className="max-w-[420px] text-[14px] leading-[1.6] text-[var(--color-text-secondary)]">
        {t('empty.subtitle')}
      </p>
    </div>
  )
}

function KeyboardHints() {
  return (
    <div className="mt-3 flex items-center justify-center gap-3 text-[10px] text-[var(--color-text-tertiary)]">
      <span className="btn-ghost px-2 py-1 rounded text-[10px]"><kbd className="font-mono opacity-90">⏎</kbd> Send</span>
      <span className="opacity-30">·</span>
      <span className="btn-ghost px-2 py-1 rounded text-[10px]"><kbd className="font-mono opacity-90">⇧⏎</kbd> Newline</span>
      <span className="opacity-30">·</span>
      <span className="btn-ghost px-2 py-1 rounded text-[10px]"><kbd className="font-mono opacity-90">/</kbd> Commands</span>
      <span className="opacity-30">·</span>
      <span className="btn-ghost px-2 py-1 rounded text-[10px]"><kbd className="font-mono opacity-90">@</kbd> Model</span>
    </div>
  )
}
