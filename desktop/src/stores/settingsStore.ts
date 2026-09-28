import { create } from 'zustand'
import { settingsApi } from '../api/settings'
import { modelsApi } from '../api/models'
import type { PermissionMode, EffortLevel, ModelInfo, ThemeMode } from '../types/settings'
import { isLocale, type Locale } from '../i18n/localeConfig'
import { useUIStore } from './uiStore'
import {
  completionSoundSetting,
  type CompletionSoundSetting,
} from '../utils/completionSound'

const LOCALE_STORAGE_KEY = 'cybercode-locale'

const LANGUAGE_BY_LOCALE: Record<Locale, string> = {
  en: 'English',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
}

let promptMemoryLanguageSync: Promise<unknown> = Promise.resolve()

function syncPromptMemoryLanguage(language: string): Promise<void> {
  const next = promptMemoryLanguageSync
    .catch(() => {})
    .then(() => settingsApi.updateUser({ promptMemoryLanguage: language }))
  promptMemoryLanguageSync = next
  return next.then(() => undefined)
}

function getStoredLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (isLocale(stored)) return stored
  } catch { /* localStorage unavailable */ }
  return 'zh'
}

type SettingsStore = {
  permissionMode: PermissionMode
  currentModel: ModelInfo | null
  effortLevel: EffortLevel
  availableModels: ModelInfo[]
  activeProviderName: string | null
  locale: Locale
  theme: ThemeMode
  skipWebFetchPreflight: boolean
  completionSoundEnabled: boolean
  completionSoundId: CompletionSoundSetting
  completionSoundCustomName: string | null
  completionSoundCustomData: string | null
  isLoading: boolean
  error: string | null

  fetchAll: () => Promise<void>
  setPermissionMode: (mode: PermissionMode) => Promise<void>
  setModel: (modelId: string) => Promise<void>
  setEffort: (level: EffortLevel) => Promise<void>
  setLocale: (locale: Locale) => Promise<void>
  setTheme: (theme: ThemeMode) => Promise<void>
  setSkipWebFetchPreflight: (enabled: boolean) => Promise<void>
  setCompletionSoundEnabled: (enabled: boolean) => Promise<void>
  setCompletionSoundId: (soundId: CompletionSoundSetting) => Promise<void>
  setCompletionSoundCustom: (custom: { name: string; data: string } | null) => Promise<void>
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  permissionMode: 'bypassPermissions',
  currentModel: null,
  effortLevel: 'medium',
  availableModels: [],
  activeProviderName: null,
  locale: getStoredLocale(),
  theme: useUIStore.getState().theme,
  skipWebFetchPreflight: true,
  completionSoundEnabled: false,
  completionSoundId: 'ding',
  completionSoundCustomName: null,
  completionSoundCustomData: null,
  isLoading: false,
  error: null,

  fetchAll: async () => {
    set({ isLoading: true, error: null })
    try {
      const [{ mode }, modelsRes, { model }, { level }, userSettings] = await Promise.all([
        settingsApi.getPermissionMode(),
        modelsApi.list(),
        modelsApi.getCurrent(),
        modelsApi.getEffort(),
        settingsApi.getUser(),
      ])
      const theme = userSettings.theme === 'dark' ? 'dark' : 'light'
      const locale = get().locale
      const selectedLanguage = LANGUAGE_BY_LOCALE[locale]
      if (userSettings.promptMemoryLanguage?.toLowerCase() !== selectedLanguage.toLowerCase()) {
        await syncPromptMemoryLanguage(selectedLanguage).catch(() => {})
      }
      useUIStore.getState().setTheme(theme)
      set({
        permissionMode: mode,
        availableModels: modelsRes.models,
        activeProviderName: modelsRes.provider?.name ?? null,
        currentModel: model,
        effortLevel: level,
        theme,
        skipWebFetchPreflight: userSettings.skipWebFetchPreflight !== false,
        completionSoundEnabled: userSettings.completionSoundEnabled === true,
        completionSoundId: completionSoundSetting(userSettings.completionSoundId),
        completionSoundCustomName: typeof userSettings.completionSoundCustomName === 'string'
          ? userSettings.completionSoundCustomName
          : null,
        completionSoundCustomData: typeof userSettings.completionSoundCustomData === 'string'
          ? userSettings.completionSoundCustomData
          : null,
        isLoading: false,
        error: null,
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load desktop settings'
      set({ isLoading: false, error: message })
      throw error
    }
  },

  setPermissionMode: async (mode) => {
    const prev = get().permissionMode
    set({ permissionMode: mode })
    try {
      await settingsApi.setPermissionMode(mode)
    } catch {
      set({ permissionMode: prev })
    }
  },

  setModel: async (modelId) => {
    await modelsApi.setCurrent(modelId)
    const { model } = await modelsApi.getCurrent()
    set({ currentModel: model })
  },

  setEffort: async (level) => {
    const prev = get().effortLevel
    set({ effortLevel: level })
    try {
      await modelsApi.setEffort(level)
    } catch {
      set({ effortLevel: prev })
    }
  },

  setLocale: async (locale) => {
    set({ locale })
    try { localStorage.setItem(LOCALE_STORAGE_KEY, locale) } catch { /* noop */ }
    await syncPromptMemoryLanguage(LANGUAGE_BY_LOCALE[locale]).catch(() => {})
  },

  setTheme: async (theme) => {
    const prev = get().theme
    set({ theme })
    useUIStore.getState().setTheme(theme)
    try {
      await settingsApi.updateUser({ theme })
    } catch {
      set({ theme: prev })
      useUIStore.getState().setTheme(prev)
    }
  },

  setSkipWebFetchPreflight: async (enabled) => {
    const prev = get().skipWebFetchPreflight
    set({ skipWebFetchPreflight: enabled })
    try {
      await settingsApi.updateUser({ skipWebFetchPreflight: enabled })
    } catch {
      set({ skipWebFetchPreflight: prev })
    }
  },

  setCompletionSoundEnabled: async (enabled) => {
    const prev = get().completionSoundEnabled
    set({ completionSoundEnabled: enabled })
    try {
      await settingsApi.updateUser({ completionSoundEnabled: enabled })
    } catch {
      set({ completionSoundEnabled: prev })
    }
  },

  setCompletionSoundId: async (soundId) => {
    const prev = get().completionSoundId
    set({ completionSoundId: soundId })
    try {
      await settingsApi.updateUser({ completionSoundId: soundId })
    } catch {
      set({ completionSoundId: prev })
    }
  },

  setCompletionSoundCustom: async (custom) => {
    const prevName = get().completionSoundCustomName
    const prevData = get().completionSoundCustomData
    const prevId = get().completionSoundId
    // Clearing while "custom" is selected falls back to the default sound,
    // otherwise the setting would point at a file that no longer exists.
    const nextId = custom
      ? 'custom' as const
      : prevId === 'custom' ? 'ding' as const : prevId
    set({
      completionSoundCustomName: custom?.name ?? null,
      completionSoundCustomData: custom?.data ?? null,
      completionSoundId: nextId,
    })
    try {
      // undefined-valued keys are dropped by JSON serialization on write,
      // which is exactly how a cleared custom sound disappears from disk.
      await settingsApi.updateUser({
        completionSoundCustomName: custom?.name,
        completionSoundCustomData: custom?.data,
        completionSoundId: nextId,
      })
    } catch {
      set({
        completionSoundCustomName: prevName,
        completionSoundCustomData: prevData,
        completionSoundId: prevId,
      })
    }
  },
}))
