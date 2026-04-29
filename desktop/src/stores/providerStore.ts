// desktop/src/stores/providerStore.ts

import { create } from 'zustand'
import { providersApi } from '../api/providers'
import { useSettingsStore } from './settingsStore'
import { OFFICIAL_DEFAULT_MODEL_ID } from '../constants/modelCatalog'
import type {
  SavedProvider,
  CreateProviderInput,
  UpdateProviderInput,
  TestProviderConfigInput,
  ProviderTestResult,
} from '../types/provider'
import type { ProviderPreset } from '../types/providerPreset'

type ProviderStore = {
  providers: SavedProvider[]
  activeId: string | null
  hasLoadedProviders: boolean
  presets: ProviderPreset[]
  isLoading: boolean
  isPresetsLoading: boolean
  error: string | null

  fetchProviders: () => Promise<void>
  fetchPresets: () => Promise<void>
  createProvider: (input: CreateProviderInput) => Promise<SavedProvider>
  updateProvider: (id: string, input: UpdateProviderInput) => Promise<SavedProvider>
  deleteProvider: (id: string) => Promise<void>
  activateProvider: (id: string) => Promise<void>
  activateOfficial: () => Promise<void>
  testProvider: (id: string, overrides?: { baseUrl?: string; modelId?: string; apiFormat?: string }) => Promise<ProviderTestResult>
  testConfig: (input: TestProviderConfigInput) => Promise<ProviderTestResult>
}

export const useProviderStore = create<ProviderStore>((set, get) => ({
  providers: [],
  activeId: null,
  hasLoadedProviders: false,
  presets: [],
  isLoading: false,
  isPresetsLoading: false,
  error: null,

  fetchProviders: async () => {
    set({ isLoading: true, error: null })
    try {
      const { providers, activeId } = await providersApi.list()
      set({ providers, activeId, hasLoadedProviders: true, isLoading: false })
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  fetchPresets: async () => {
    set({ isPresetsLoading: true, error: null })
    try {
      const { presets } = await providersApi.presets()
      set({ presets, isPresetsLoading: false })
    } catch (err) {
      set({ isPresetsLoading: false, error: err instanceof Error ? err.message : String(err) })
    }
  },

  createProvider: async (input) => {
    const { provider } = await providersApi.create(input)
    await get().fetchProviders()
    return provider
  },

  updateProvider: async (id, input) => {
    const { provider } = await providersApi.update(id, input)
    await get().fetchProviders()
    return provider
  },

  deleteProvider: async (id) => {
    await providersApi.delete(id)
    await get().fetchProviders()
  },

  activateProvider: async (id) => {
    await providersApi.activate(id)
    await get().fetchProviders()
    // 更新默认 provider 时，同步刷新默认 model，避免 settings.json 里残留
    // 旧 provider 的 model id 导致默认选择指向不存在的模型。
    const provider = get().providers.find((p) => p.id === id)
    if (provider) {
      const settings = useSettingsStore.getState()
      await settings.setModel(provider.models.main)
      await settings.fetchAll()
    }
  },

  activateOfficial: async () => {
    await providersApi.activateOfficial()
    await get().fetchProviders()
    // 切回官方默认时同样重置 currentModel，避免残留第三方 model id。
    const settings = useSettingsStore.getState()
    await settings.setModel(OFFICIAL_DEFAULT_MODEL_ID)
    await settings.fetchAll()
  },

  testProvider: async (id, overrides?) => {
    const { result } = await providersApi.test(id, overrides)
    return result
  },

  testConfig: async (input) => {
    const { result } = await providersApi.testConfig(input)
    return result
  },
}))
