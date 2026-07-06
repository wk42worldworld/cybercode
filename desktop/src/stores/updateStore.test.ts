import { beforeEach, describe, expect, it, vi } from 'vitest'

const check = vi.fn()
const relaunch = vi.fn()
const invoke = vi.fn()

vi.mock('@tauri-apps/plugin-updater', () => ({
  check,
}))

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch,
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke,
}))

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('updateStore', () => {
  beforeEach(() => {
    check.mockReset()
    relaunch.mockReset()
    invoke.mockReset()
    window.localStorage.clear()
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    })
  })

  it('stores available update metadata and predownloads after a successful check', async () => {
    const download = vi.fn(async (onEvent?: (event: unknown) => void) => {
      onEvent?.({ event: 'Started', data: { contentLength: 200 } })
      onEvent?.({ event: 'Progress', data: { chunkLength: 200 } })
      onEvent?.({ event: 'Finished' })
    })
    const update = {
      version: '0.2.0',
      body: 'Bug fixes and performance improvements',
      download,
      close: vi.fn().mockResolvedValue(undefined),
    }
    check.mockResolvedValue(update)

    vi.resetModules()
    const { useUpdateStore } = await import('./updateStore')

    const result = await useUpdateStore.getState().checkForUpdates()

    expect(result).toBe(update)
    expect(useUpdateStore.getState().status).toBe('downloaded')
    expect(useUpdateStore.getState().availableVersion).toBe('0.2.0')
    expect(useUpdateStore.getState().releaseNotes).toBe('Bug fixes and performance improvements')
    expect(useUpdateStore.getState().shouldPrompt).toBe(false)

    await tick()

    expect(download).toHaveBeenCalledTimes(1)
    expect(useUpdateStore.getState().status).toBe('downloaded')
    expect(useUpdateStore.getState().progressPercent).toBe(100)
  })

  it('keeps the popup prompt hidden after dismissing once', async () => {
    const download = vi.fn().mockResolvedValue(undefined)
    check.mockResolvedValue({
      version: '0.2.0',
      body: 'Bug fixes and performance improvements',
      download,
      close: vi.fn().mockResolvedValue(undefined),
    })

    vi.resetModules()
    const { useUpdateStore } = await import('./updateStore')

    await useUpdateStore.getState().checkForUpdates()
    await tick()
    useUpdateStore.getState().dismissPrompt()

    expect(useUpdateStore.getState().shouldPrompt).toBe(false)
    expect(window.localStorage.getItem('cybercode-dismissed-update-version')).toBe('0.2.0')

    await useUpdateStore.getState().checkForUpdates({ silent: true })
    await tick()

    expect(useUpdateStore.getState().status).toBe('downloaded')
    expect(useUpdateStore.getState().availableVersion).toBe('0.2.0')
    expect(useUpdateStore.getState().shouldPrompt).toBe(false)
  })

  it('predownloads again when a newer version is available after dismissing an older one', async () => {
    const oldDownload = vi.fn().mockResolvedValue(undefined)
    const nextDownload = vi.fn().mockResolvedValue(undefined)
    check
      .mockResolvedValueOnce({
        version: '0.2.0',
        body: 'Bug fixes and performance improvements',
        download: oldDownload,
        close: vi.fn().mockResolvedValue(undefined),
      })
      .mockResolvedValueOnce({
        version: '0.3.0',
        body: 'New release',
        download: nextDownload,
        close: vi.fn().mockResolvedValue(undefined),
      })

    vi.resetModules()
    const { useUpdateStore } = await import('./updateStore')

    await useUpdateStore.getState().checkForUpdates()
    await tick()
    useUpdateStore.getState().dismissPrompt()
    await useUpdateStore.getState().checkForUpdates({ silent: true })
    await tick()

    expect(useUpdateStore.getState().availableVersion).toBe('0.3.0')
    expect(useUpdateStore.getState().status).toBe('downloaded')
    expect(useUpdateStore.getState().shouldPrompt).toBe(false)
    expect(nextDownload).toHaveBeenCalledTimes(1)
  })

  it('installs a predownloaded update without downloading again, then relaunches', async () => {
    const download = vi.fn(async (onEvent?: (event: unknown) => void) => {
      onEvent?.({ event: 'Started', data: { contentLength: 200 } })
      onEvent?.({ event: 'Progress', data: { chunkLength: 50 } })
      onEvent?.({ event: 'Progress', data: { chunkLength: 150 } })
      onEvent?.({ event: 'Finished' })
    })
    const install = vi.fn().mockResolvedValue(undefined)

    check.mockResolvedValue({
      version: '0.2.0',
      body: 'Notes',
      download,
      install,
      close: vi.fn().mockResolvedValue(undefined),
    })
    invoke.mockResolvedValue(undefined)
    relaunch.mockResolvedValue(undefined)

    vi.resetModules()
    const { useUpdateStore } = await import('./updateStore')

    await useUpdateStore.getState().checkForUpdates()
    await tick()
    expect(useUpdateStore.getState().status).toBe('downloaded')

    await useUpdateStore.getState().installUpdate()

    expect(download).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('prepare_for_update_install')
    expect(install).toHaveBeenCalledTimes(1)
    const prepareCallOrder = invoke.mock.invocationCallOrder[0]
    const installCallOrder = install.mock.invocationCallOrder[0]
    expect(prepareCallOrder).toBeDefined()
    expect(installCallOrder).toBeDefined()
    expect(prepareCallOrder!).toBeLessThan(installCallOrder!)
    expect(useUpdateStore.getState().progressPercent).toBe(100)
    expect(useUpdateStore.getState().status).toBe('restarting')
    expect(relaunch).toHaveBeenCalledTimes(1)
  })
})
