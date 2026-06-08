import { useCallback } from 'react'
import { useChatStore } from '../stores/chatStore'
import { useSessionStore } from '../stores/sessionStore'
import { useTabStore } from '../stores/tabStore'
import { useUIStore } from '../stores/uiStore'
import { useTranslation } from '../i18n'
import { getDefaultSessionTitle } from '../utils/sessionTitle'

export function useCreateAndOpenSession() {
  const createSession = useSessionStore((state) => state.createSession)
  const t = useTranslation()

  return useCallback(async (workDir?: string): Promise<boolean> => {
    try {
      const newSessionId = await createSession(workDir)
      const createdSession = useSessionStore.getState().sessions.find((session) => session.id === newSessionId)

      useTabStore.getState().openTab(newSessionId, getDefaultSessionTitle(t), 'session', createdSession?.projectPath)
      void useChatStore.getState().ensureSessionReady(newSessionId, createdSession?.projectPath)
      useUIStore.getState().setActiveView('code')
      useUIStore.getState().setRailSettingsView(null)
      return true
    } catch (error) {
      useUIStore.getState().addToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('empty.failedToCreate'),
      })
      return false
    }
  }, [createSession, t])
}
