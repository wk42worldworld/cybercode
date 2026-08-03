import { useProviderStore } from '../../stores/providerStore'
import { useRoutingStore } from '../../stores/routingStore'
import { useSessionRuntimeStore } from '../../stores/sessionRuntimeStore'
import type { SavedProvider } from '../../types/provider'

// Mirrors src/utils/localModelPerformance.ts so the UI can detect when the
// active session talks to a local inference backend (ollama / llama.cpp /
// LM Studio) and adjust its copy accordingly. The rules must stay identical:
// known cloud presets win over the URL signal, known local presets are local
// anywhere, custom/unknown presets fall back to loopback + RFC1918 matching.
const LOCAL_PROVIDER_PRESETS = new Set([
  'ollama',
  'lmstudio',
  'llama.cpp',
  'llama-cpp',
  'llamacpp',
])
const KNOWN_CLOUD_PROVIDER_PRESETS = new Set([
  'openai',
  'anthropic',
  'anthropic-api',
  'official',
  'google',
  'gemini',
  'deepseek',
  'xai',
  'kimi',
  'kimi-code',
  'zhipuglm',
  'glm',
  'minimax',
  'mistral',
  'perplexity',
  'cohere',
  'meta-llama',
  'ai21',
  'reka',
  'nous-research',
  'xiaomimimo',
  'openrouter',
  'cloudflare-ai',
  'ollama-cloud',
  'llm7',
  'alibaba',
  'qwen',
  'volcengine',
  'qianfan',
  'baidu',
  'siliconflow',
  'groq',
  'github-models',
  'huggingface',
  'nvidia',
  'fireworks',
  'deepinfra',
  'cerebras',
  'sambanova',
  'modelscope',
  'hyperbolic',
  'nebius',
  'friendliai',
  'featherless-ai',
  'pioneer',
  'bytez',
  'openvecta',
  'synthetic',
  'kilo-gateway',
  'aimlapi',
  'novita',
  'piapi',
  'getgoapi',
  'laozhang',
  'vercel-ai-gateway',
  'agentrouter',
  'thebai',
  'fenayai',
  'empower',
  'poe',
  'chutes',
  'hackclub',
  'freetheai',
  'nanogpt',
  'opencode-free',
])
const LOCAL_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  '0.0.0.0',
  '::',
  '::1',
  'ollama',
  'host.docker.internal',
  'gateway.docker.internal',
])

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, '')
}

// RFC1918 private ranges: fallback for self-hosted inference on LAN hosts
// (e.g. ollama on another machine at 192.168.x.x).
function isRfc1918IPv4(hostname: string): boolean {
  return (
    /^10(?:\.\d{1,3}){3}$/.test(hostname) ||
    /^172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/.test(hostname) ||
    /^192\.168(?:\.\d{1,3}){2}$/.test(hostname)
  )
}

export function isLocalProviderBaseUrl(value: string | null | undefined): boolean {
  const raw = value?.trim()
  if (!raw) return false

  try {
    const hostname = normalizeHostname(new URL(raw).hostname)
    return (
      LOCAL_HOSTS.has(hostname) ||
      hostname.endsWith('.localhost') ||
      /^127(?:\.\d{1,3}){3}$/.test(hostname) ||
      isRfc1918IPv4(hostname)
    )
  } catch {
    return false
  }
}

export function isLocalProvider(
  provider: Pick<SavedProvider, 'presetId' | 'baseUrl'>,
): boolean {
  const presetId = provider.presetId?.trim().toLowerCase()
  // A known cloud preset wins over the URL signal: loopback there is a
  // gateway (LiteLLM / one-api / ssh -L), not local inference.
  if (presetId && KNOWN_CLOUD_PROVIDER_PRESETS.has(presetId)) return false
  // Known local runtimes are local wherever they run, including LAN hosts.
  if (presetId && LOCAL_PROVIDER_PRESETS.has(presetId)) return true
  // custom/unknown presets: fall back to the URL signal.
  return isLocalProviderBaseUrl(provider.baseUrl)
}

function selectSessionProviderId(
  selectionProviderId: string | null | undefined,
  routeId: string | undefined,
  profiles: Array<{ id: string, targets: Array<{ providerId: string }> }> | undefined,
  activeId: string | null,
): string | null {
  if (routeId) {
    const profile = profiles?.find((entry) => entry.id === routeId)
    return profile?.targets[0]?.providerId ?? activeId
  }
  return selectionProviderId ?? activeId
}

export function useIsLocalSessionProvider(sessionId: string | undefined): boolean {
  const selection = useSessionRuntimeStore((state) =>
    sessionId ? state.selections[sessionId] : undefined,
  )
  const providers = useProviderStore((state) => state.providers)
  const activeId = useProviderStore((state) => state.activeId)
  const profiles = useRoutingStore((state) => state.dashboard?.config.profiles)

  const providerId = selectSessionProviderId(
    selection?.kind === 'route' ? undefined : selection?.providerId,
    selection?.kind === 'route' ? selection.routeId : undefined,
    profiles,
    activeId,
  )
  const provider = providers.find((entry) => entry.id === providerId)
  return provider ? isLocalProvider(provider) : false
}
