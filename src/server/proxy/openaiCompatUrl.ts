export type OpenAICompatibleEndpoint = 'chat/completions' | 'responses'

export function buildOpenAICompatibleUrl(baseUrl: string, endpoint: OpenAICompatibleEndpoint): string {
  const base = baseUrl.replace(/\/+$/, '')

  try {
    const parsed = new URL(base)
    const path = parsed.pathname.replace(/\/+$/, '')
    const alreadyVersioned = /\/v\d+(?:beta)?(?:\/openai)?$/.test(path)
    const suffix = alreadyVersioned ? endpoint : `v1/${endpoint}`

    parsed.pathname = `${path}/${suffix}`.replace(/\/{2,}/g, '/')
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString()
  } catch {
    const alreadyVersioned = /\/v\d+(?:beta)?(?:\/openai)?$/.test(base)
    return `${base}/${alreadyVersioned ? endpoint : `v1/${endpoint}`}`
  }
}
