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
      await waitForHealth(connection.url)
      return connection
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

async function waitForHealth(serverUrl: string) {
  let lastError: unknown

  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(`${serverUrl}/health`, {
        cache: 'no-store',
      })
      if (response.ok) {
        return
      }
      lastError = new Error(`healthcheck returned ${response.status}`)
    } catch (error) {
      lastError = error
    }

    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  throw new Error(
    lastError instanceof Error
      ? `Local server healthcheck failed: ${lastError.message}`
      : 'Local server healthcheck failed',
  )
}
