import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('settingsStore locale defaults', () => {
  beforeEach(() => {
    vi.resetModules()
    window.localStorage.clear()
  })

  it('defaults to Chinese when no locale is stored', async () => {
    const { useSettingsStore } = await import('./settingsStore')

    expect(useSettingsStore.getState().locale).toBe('zh')
  })

  it('defaults new desktop users to bypass permissions mode', async () => {
    const { useSettingsStore } = await import('./settingsStore')

    expect(useSettingsStore.getState().permissionMode).toBe('bypassPermissions')
  })

  it('keeps a stored locale override', async () => {
    window.localStorage.setItem('cybercode-locale', 'ja')

    const { useSettingsStore } = await import('./settingsStore')

    expect(useSettingsStore.getState().locale).toBe('ja')
  })

  it('falls back to Chinese for unsupported stored locales', async () => {
    window.localStorage.setItem('cybercode-locale', 'fr')

    const { useSettingsStore } = await import('./settingsStore')

    expect(useSettingsStore.getState().locale).toBe('zh')
  })

  it('persists the selected UI locale as the agent language', async () => {
    const { settingsApi } = await import('../api/settings')
    const updateSpy = vi.spyOn(settingsApi, 'updateUser').mockResolvedValue({ ok: true })
    const { useSettingsStore } = await import('./settingsStore')

    await useSettingsStore.getState().setLocale('ja')

    expect(useSettingsStore.getState().locale).toBe('ja')
    expect(window.localStorage.getItem('cybercode-locale')).toBe('ja')
    expect(updateSpy).toHaveBeenCalledWith({ promptMemoryLanguage: 'Japanese' })
  })

  it('rolls back the UI locale when the agent language cannot be saved', async () => {
    const { settingsApi } = await import('../api/settings')
    vi.spyOn(settingsApi, 'updateUser').mockRejectedValue(new Error('write failed'))
    const { useSettingsStore } = await import('./settingsStore')

    await useSettingsStore.getState().setLocale('ko')

    expect(useSettingsStore.getState().locale).toBe('zh')
    expect(window.localStorage.getItem('cybercode-locale')).toBe('zh')
  })

  it('syncs the current UI locale for existing users during settings load', async () => {
    const { settingsApi } = await import('../api/settings')
    const { modelsApi } = await import('../api/models')
    vi.spyOn(settingsApi, 'getPermissionMode').mockResolvedValue({ mode: 'bypassPermissions' })
    vi.spyOn(settingsApi, 'getUser').mockResolvedValue({ theme: 'light' })
    const updateSpy = vi.spyOn(settingsApi, 'updateUser').mockResolvedValue({ ok: true })
    vi.spyOn(modelsApi, 'list').mockResolvedValue({ models: [], provider: null })
    vi.spyOn(modelsApi, 'getCurrent').mockResolvedValue({
      model: {
        id: 'test-model',
        name: 'Test model',
        description: '',
        context: '',
      },
    })
    vi.spyOn(modelsApi, 'getEffort').mockResolvedValue({
      level: 'medium',
      available: ['low', 'medium', 'high'],
    })
    const { useSettingsStore } = await import('./settingsStore')

    await useSettingsStore.getState().fetchAll()

    expect(updateSpy).toHaveBeenCalledWith({ promptMemoryLanguage: 'Chinese' })
  })
})
