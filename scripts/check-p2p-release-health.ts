import { appendFileSync } from 'node:fs'

type HealthCheck = { available: boolean; message: string }
type FetchHealth = (url: string, options: RequestInit) => Promise<Response>

export async function checkP2PReleaseHealth(
  endpoint: string | undefined,
  fetchHealth: FetchHealth = fetch,
): Promise<HealthCheck> {
  let url: URL
  try {
    url = new URL(endpoint?.trim() || '')
  } catch {
    throw new Error('CYBERCODE_P2P_SIGNAL_URL must contain a valid public HTTPS signaling endpoint')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('The P2P signaling endpoint must use HTTPS without credentials, query parameters or a fragment')
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/health`

  let response: Response
  try {
    response = await fetchHealth(url.toString(), { signal: AbortSignal.timeout(10_000) })
  } catch {
    return {
      available: false,
      message: 'P2P signaling could not be reached. P2P model sharing needs this service; desktop packaging can continue.',
    }
  }
  if (response.status === 429 || response.status >= 500) {
    return {
      available: false,
      message: `P2P signaling returned HTTP ${response.status}. P2P model sharing may be unavailable; desktop packaging can continue.`,
    }
  }
  if (!response.ok) {
    throw new Error(`P2P signaling health returned HTTP ${response.status}; check the configured endpoint`)
  }
  const health = await response.json()
  if (health?.status !== 'ok' || health?.transport !== 'webrtc-signaling') {
    throw new Error('P2P endpoint returned an unexpected health payload')
  }
  return { available: true, message: 'P2P signaling health check passed.' }
}

if (import.meta.main) {
  const result = await checkP2PReleaseHealth(process.env.CYBERCODE_P2P_BUILTIN_SIGNAL_URL)
  console.log(result.available ? result.message : `::warning::${result.message}`)
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### P2P signaling availability\n\n${result.message}\n`)
  }
}
