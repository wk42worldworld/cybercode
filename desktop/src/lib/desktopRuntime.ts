import {
  getDefaultBaseUrl,
  setAuthToken,
  setBaseUrl,
  setServerConnectionRefresher,
} from '../api/client'

export function isTauriRuntime() {
  if (typeof window === 'undefined') return false
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window
}

export async function initializeDesktopServerUrl() {
  const fallbackUrl = getDefaultBaseUrl()
  const queryUrl =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('serverUrl')
      : null
  const requestedUrl = queryUrl?.trim() || fallbackUrl

  if (!isTauriRuntime()) {
    setServerConnectionRefresher(null)
    setBaseUrl(requestedUrl)
    await waitForHealth(requestedUrl)
    return requestedUrl
  }

  try {
    const { invoke } = await import(/* @vite-ignore */ '@tauri-apps/api/core')
    const refreshConnection = async () => {
      const connection = await invoke<{ url: string; authToken: string }>('get_server_connection')
      try {
        await waitForHealth(connection.url, { attempts: 2 })
        return connection
      } catch (error) {
        console.warn('[desktop] Local server is unresponsive; restarting it', error)
        const restarted = await invoke<{ url: string; authToken: string }>('restart_server_sidecar', {
          expectedUrl: connection.url,
        })
        await waitForHealth(restarted.url)
        return restarted
      }
    }
    setServerConnectionRefresher(refreshConnection)
    const connection = await refreshConnection()
    setBaseUrl(connection.url)
    setAuthToken(connection.authToken)
    return connection.url
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `desktop server startup failed: ${String(error)}`
    console.error('[desktop] Failed to initialize desktop server URL', error)
    throw new Error(message || `desktop server startup failed (fallback would be ${fallbackUrl})`)
  }
}

async function waitForHealth(
  serverUrl: string,
  options: { attempts?: number; requestTimeoutMs?: number } = {},
) {
  let lastError: unknown
  const attempts = options.attempts ?? 30
  const requestTimeoutMs = options.requestTimeoutMs ?? 1_000

  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)
    try {
      const response = await fetch(`${serverUrl}/health`, {
        cache: 'no-store',
        signal: controller.signal,
      })
      if (response.ok) {
        return
      }
      lastError = new Error(`healthcheck returned ${response.status}`)
    } catch (error) {
      lastError = error
    } finally {
      clearTimeout(timeout)
    }

    if (attempt + 1 < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }

  throw new Error(
    lastError instanceof Error
      ? `Local server healthcheck failed: ${lastError.message}`
      : 'Local server healthcheck failed',
  )
}
