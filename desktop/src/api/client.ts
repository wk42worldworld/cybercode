const ENV_BASE_URL =
  typeof import.meta !== 'undefined' &&
  typeof import.meta.env?.VITE_DESKTOP_SERVER_URL === 'string' &&
  import.meta.env.VITE_DESKTOP_SERVER_URL.length > 0
    ? import.meta.env.VITE_DESKTOP_SERVER_URL
    : undefined

const DEFAULT_BASE_URL = ENV_BASE_URL || 'http://127.0.0.1:3456'

let baseUrl = DEFAULT_BASE_URL
let authToken = ''
type ServerConnection = { url: string; authToken: string }
type ServerConnectionRefresher = () => Promise<ServerConnection>
let serverConnectionRefresher: ServerConnectionRefresher | null = null
let serverConnectionRefreshPromise: Promise<boolean> | null = null

function getErrorMessage(status: number, body: unknown) {
  if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') {
    return body.message
  }

  if (typeof body === 'string' && body.trim().length > 0) {
    return body
  }

  return `API error ${status}`
}

export function setBaseUrl(url: string) {
  baseUrl = url.replace(/\/$/, '')
}

export function getBaseUrl() {
  return baseUrl
}

export function getDefaultBaseUrl() {
  return DEFAULT_BASE_URL
}

export function setAuthToken(token: string) {
  authToken = token
}

export function getAuthToken() {
  return authToken
}

export function setServerConnectionRefresher(refresher: ServerConnectionRefresher | null) {
  serverConnectionRefresher = refresher
  serverConnectionRefreshPromise = null
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(getErrorMessage(status, body))
    this.name = 'ApiError'
  }
}

function shouldRefreshLocalConnection(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status === 401 || error.status === 502 || error.status === 503 || error.status === 504
  }
  return error instanceof TypeError
}

async function refreshLocalConnection(): Promise<boolean> {
  if (!serverConnectionRefresher) return false
  if (serverConnectionRefreshPromise) return serverConnectionRefreshPromise

  const refresher = serverConnectionRefresher
  const refresh = refresher()
    .then((connection) => {
      setBaseUrl(connection.url)
      setAuthToken(connection.authToken)
      return true
    })
    .catch((error) => {
      console.warn('[api] Local desktop service reconnection failed', error)
      return false
    })

  serverConnectionRefreshPromise = refresh
  try {
    return await refresh
  } finally {
    if (serverConnectionRefreshPromise === refresh) {
      serverConnectionRefreshPromise = null
    }
  }
}

type RequestOptions = {
  timeout?: number
  signal?: AbortSignal
}

function createCallerAbortError(signal?: AbortSignal) {
  const reason = signal && 'reason' in signal ? signal.reason : undefined
  if (reason instanceof Error) return reason
  const error = new Error('Request cancelled')
  error.name = 'AbortError'
  return error
}

function throwIfCallerAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw createCallerAbortError(signal)
}

async function request<T>(method: string, path: string, body?: unknown, options?: RequestOptions): Promise<T> {
  const timeoutMs = options?.timeout ?? 30_000
  const maxAttempts = method === 'GET' ? 2 : 1

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    throwIfCallerAborted(options?.signal)
    const controller = new AbortController()
    const abortFromCaller = () => controller.abort()
    options?.signal?.addEventListener('abort', abortFromCaller, { once: true })
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const url = `${baseUrl}${path}`
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      }
      const res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })

      if (!res.ok) {
        const errorBody = await res.json().catch(() => res.text())
        throw new ApiError(res.status, errorBody)
      }

      if (res.status === 204) return undefined as T
      return res.json() as Promise<T>
    } catch (error) {
      if (options?.signal?.aborted) {
        throw createCallerAbortError(options.signal)
      }
      if (controller.signal.aborted) {
        throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`)
      }
      if (
        method === 'GET' &&
        attempt === 0 &&
        shouldRefreshLocalConnection(error) &&
        await refreshLocalConnection()
      ) {
        continue
      }
      throw error
    } finally {
      clearTimeout(timeout)
      options?.signal?.removeEventListener('abort', abortFromCaller)
    }
  }

  throw new Error('Local desktop service request failed')
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('POST', path, body, options),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string, options?: RequestOptions) => request<T>('DELETE', path, undefined, options),
}
