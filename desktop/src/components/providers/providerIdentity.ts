export type ProviderLogoMotif =
  | 'asset'
  | 'monogram'
  | 'orbit'
  | 'spark'
  | 'blocks'
  | 'slash'
  | 'loop'
  | 'chip'

export type ProviderLogoIdentity = {
  id: string
  label: string
  initials: string
  accent: string
  motif: ProviderLogoMotif
  assetSrc?: string
  assetScale?: number
  assetShadow?: boolean
}

type ProviderIdentityDefinition = ProviderLogoIdentity & {
  matchers: string[]
}

export type ProviderIdentityInput = {
  providerId?: string | null
  name?: string | null
  baseUrl?: string | null
  modelId?: string | null
}

const KNOWN_PROVIDER_IDENTITIES: ProviderIdentityDefinition[] = [
  {
    id: 'official',
    label: 'Claude',
    initials: 'C',
    accent: '#8a6f4d',
    motif: 'asset',
    assetSrc: '/provider-icons/styled/cybercode-claude.png',
    assetScale: 0.9,
    matchers: ['official', 'claude'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    initials: 'DS',
    accent: '#2563eb',
    motif: 'asset',
    assetSrc: '/provider-icons/styled/cybercode-deepseek.png',
    assetScale: 0.9,
    matchers: ['deepseek'],
  },
  {
    id: 'zhipuglm',
    label: 'GLM',
    initials: 'GL',
    accent: '#2563eb',
    motif: 'asset',
    assetSrc: '/provider-icons/styled/cybercode-glm.png',
    assetScale: 0.9,
    matchers: ['zhipuglm', 'zhipu', 'bigmodel', 'glm'],
  },
  {
    id: 'kimi',
    label: 'Kimi',
    initials: 'K',
    accent: '#4f46e5',
    motif: 'asset',
    assetSrc: '/provider-icons/styled/cybercode-kimi.png',
    assetScale: 0.9,
    matchers: ['kimi', 'kimi-code', 'moonshot'],
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    initials: 'MM',
    accent: '#dc2626',
    motif: 'asset',
    assetSrc: '/provider-icons/styled/cybercode-minimax.png',
    assetScale: 0.9,
    matchers: ['minimax', 'minimaxi'],
  },
  {
    id: 'xiaomimimo',
    label: 'MiMo',
    initials: 'MI',
    accent: '#f97316',
    motif: 'asset',
    assetSrc: '/provider-icons/styled/cybercode-mimo.png',
    assetScale: 0.9,
    matchers: ['xiaomimimo', 'xiaomi', 'mimo'],
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    initials: 'LM',
    accent: '#0f766e',
    motif: 'asset',
    assetSrc: '/provider-icons/styled/cybercode-lmstudio.png',
    assetScale: 0.9,
    matchers: ['lmstudio', 'lm studio'],
  },
  {
    id: 'ollama',
    label: 'Ollama',
    initials: 'OL',
    accent: '#374151',
    motif: 'asset',
    assetSrc: '/provider-icons/styled/cybercode-ollama.png',
    assetScale: 0.9,
    matchers: ['ollama'],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    initials: 'OA',
    accent: '#111111',
    motif: 'asset',
    assetSrc: '/provider-icons/official/openai-blossom.svg',
    assetScale: 0.72,
    assetShadow: false,
    matchers: ['openai', 'chatgpt', 'gpt4', 'gpt5', 'gptoss'],
  },
  {
    id: 'google',
    label: 'Gemini',
    initials: 'G',
    accent: '#2563eb',
    motif: 'asset',
    assetSrc: '/provider-icons/official/google-gemini.png',
    assetScale: 0.76,
    assetShadow: false,
    matchers: ['google', 'gemini', 'aistudio', 'generativelanguage'],
  },
  {
    id: 'qwen',
    label: 'Qwen',
    initials: 'Q',
    accent: '#7c3aed',
    motif: 'orbit',
    matchers: ['qwen', 'dashscope', 'alibaba', 'tongyi'],
  },
  {
    id: 'mistral',
    label: 'Mistral',
    initials: 'M',
    accent: '#d97706',
    motif: 'blocks',
    matchers: ['mistral', 'codestral', 'mixtral'],
  },
  {
    id: 'xai',
    label: 'xAI',
    initials: 'X',
    accent: '#111827',
    motif: 'slash',
    matchers: ['xai', 'grok'],
  },
  {
    id: 'meta',
    label: 'Meta',
    initials: 'ME',
    accent: '#2563eb',
    motif: 'loop',
    matchers: ['meta', 'llama'],
  },
  {
    id: 'groq',
    label: 'Groq',
    initials: 'GQ',
    accent: '#ea580c',
    motif: 'blocks',
    matchers: ['groq'],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    initials: 'OR',
    accent: '#334155',
    motif: 'orbit',
    matchers: ['openrouter'],
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow',
    initials: 'SF',
    accent: '#0891b2',
    motif: 'chip',
    matchers: ['siliconflow'],
  },
]

const FALLBACK_ACCENTS = [
  '#0f766e',
  '#2563eb',
  '#7c3aed',
  '#d97706',
  '#be123c',
  '#475569',
] as const

export function resolveProviderIdentity(input: ProviderIdentityInput): ProviderLogoIdentity {
  const exactProviderId = compactIdentityToken(input.providerId)
  if (exactProviderId) {
    const exact = KNOWN_PROVIDER_IDENTITIES.find((identity) => compactIdentityToken(identity.id) === exactProviderId)
    if (exact) return stripMatchers(exact)
  }

  const haystack = compactIdentityToken([
    input.providerId,
    input.name,
    input.baseUrl,
    input.modelId,
  ].filter(Boolean).join(' '))

  if (haystack) {
    for (const identity of KNOWN_PROVIDER_IDENTITIES) {
      if (identity.matchers.some((matcher) => haystack.includes(compactIdentityToken(matcher)))) {
        return stripMatchers(identity)
      }
    }
  }

  const label = input.name?.trim() || input.providerId?.trim() || 'Custom Provider'
  const accent = FALLBACK_ACCENTS[hashProviderName(label) % FALLBACK_ACCENTS.length]!
  return {
    id: `generated-${compactIdentityToken(label) || 'custom'}`,
    label,
    initials: getProviderInitials(label),
    accent,
    motif: 'monogram',
  }
}

export function getProviderInitials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return 'AI'
  const asciiParts = trimmed.match(/[A-Za-z0-9]+/g)
  if (asciiParts?.length) {
    return asciiParts.slice(0, 2).map((part) => part[0]).join('').toUpperCase()
  }
  return Array.from(trimmed).slice(0, 2).join('')
}

function stripMatchers(identity: ProviderIdentityDefinition): ProviderLogoIdentity {
  const { matchers: _matchers, ...rest } = identity
  return rest
}

function compactIdentityToken(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
}

function hashProviderName(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash
}
