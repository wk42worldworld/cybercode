import { useState, type ReactNode } from 'react'
import { Bot } from 'lucide-react'

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
      <Bot size={48} strokeWidth={1.5} className="mb-4 text-[var(--color-text-tertiary)]" />
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
    <HeroEmptyLayout
      hero={<HeroBlock t={t} />}
      composer={<ChatInput sessionId={sessionId} variant="hero" runtimeKey={sessionId} />}
    />
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
    <HeroEmptyLayout
      hero={<HeroBlock t={t} />}
      composer={
        <ChatInput
          variant="hero"
          onSubmit={handleSubmit}
          workDir={workDir}
          onWorkDirChange={setWorkDir}
          runtimeKey={DRAFT_RUNTIME_SELECTION_KEY}
        />
      }
    />
  )
}

// ─── Shared sub-components ───────────────────────────────────────────────────

function HeroEmptyLayout({
  hero,
  composer,
}: {
  hero: ReactNode
  composer: ReactNode
}) {
  return (
    <div className="relative flex flex-1 overflow-hidden px-[24px] md:px-[48px]">
      <div className="flex flex-1 items-center justify-center pb-[220px] pt-[16px]">
        <div className="w-full max-w-[896px]">
          {hero}
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-20 flex justify-center p-[24px]">
        <div className="pointer-events-auto w-full max-w-[896px]">
          {composer}
        </div>
      </div>
    </div>
  )
}

function HeroBlock({ t }: { t: TranslateFn }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="mb-[20px] flex h-[64px] w-[64px] items-center justify-center rounded-full border-2 border-[var(--color-border)] bg-[var(--color-surface-container-lowest)]">
        <div className="h-[24px] w-[24px] rounded-full border-[3px] border-[var(--color-text-primary)]" />
      </div>
      <h1
        className="mb-[8px] !text-[32px] font-bold !leading-[35.2px] !tracking-[0] text-[var(--color-text-primary)]"
      >
        {t('empty.title')}
      </h1>
      <p className="max-w-[420px] text-[14px] font-medium leading-[1.6] text-[var(--color-text-secondary)]">
        {t('empty.subtitle')}
      </p>
    </div>
  )
}
