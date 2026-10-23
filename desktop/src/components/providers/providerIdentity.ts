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
  assetBackground?: string
}

type ProviderIdentityDefinition = ProviderLogoIdentity & {
  matchers: string[]
}

export type ProviderIdentityInput = {
  providerId?: string | null
  name?: string | null
  baseUrl?: string | null
  modelId?: string | null
  identityPriority?: 'provider' | 'model'
}

const BRAND_ICON_ROOT = '/provider-icons/brands'

const EXACT_PROVIDER_ID_ALIASES: Record<string, string> = {
  claude: 'official',
  github: 'github-copilot',
  kimicoding: 'kimi-code',
}

function brandIdentity(
  id: string,
  label: string,
  initials: string,
  accent: string,
  asset: string,
  matchers: string[],
  assetScale = 0.72,
  assetBackground = '#ffffff',
): ProviderIdentityDefinition {
  return {
    id,
    label,
    initials,
    accent,
    motif: 'asset',
    assetSrc: `${BRAND_ICON_ROOT}/${asset}`,
    assetScale,
    assetShadow: false,
    assetBackground,
    matchers,
  }
}

const KNOWN_PROVIDER_IDENTITIES: ProviderIdentityDefinition[] = [
  brandIdentity('copilot-web', 'Microsoft Copilot Web', 'MC', '#0f6cbd', 'web-copilot.svg', ['copilot-web']),
  brandIdentity('yuanbao-web', 'Tencent Yuanbao', 'TY', '#dc2626', 'web-yuanbao.svg', ['yuanbao-web']),
  brandIdentity('huggingchat', 'HuggingChat', 'HC', '#ff9d0b', 'web-huggingchat.svg', ['huggingchat']),
  brandIdentity('muse-spark-web', 'Meta AI Web', 'MA', '#0668e1', 'web-metaai.svg', ['muse-spark-web']),
  brandIdentity('lmarena', 'LMArena', 'LM', '#111111', 'web-lmarena.svg', ['lmarena'], 0.76),
  brandIdentity('t3-web', 't3.chat Web', 'T3', '#3b82f6', 'web-t3.svg', ['t3-web']),
  brandIdentity('blackbox-web', 'Blackbox Web', 'BB', '#111111', 'web-blackbox.png', ['blackbox-web'], 0.76),
  brandIdentity('v0-vercel-web', 'v0 Web', 'V0', '#111111', 'web-v0.svg', ['v0-vercel-web'], 0.68, '#111111'),
  brandIdentity('doubao-web', 'Dola Web', 'DO', '#1e37fc', 'web-doubao.svg', ['doubao-web']),
  brandIdentity('copilot-m365-web', 'Microsoft 365 Copilot', 'MC', '#0f6cbd', 'web-copilot.svg', ['copilot-m365-web']),
  brandIdentity('zenmux-free', 'ZenMux Free', 'ZM', '#059669', 'web-zenmux.svg', ['zenmux-free']),
  brandIdentity('adapta-web', 'Adapta One Web', 'AD', '#111827', 'web-adapta.png', ['adapta-web'], 0.76),
  brandIdentity('inner-ai', 'Inner.ai Web', 'IA', '#111827', 'web-inner-ai.png', ['inner-ai'], 0.76),
  brandIdentity('venice-web', 'Venice Web', 'VE', '#111111', 'web-venice.png', ['venice-web'], 0.76),
  brandIdentity('codex', 'OpenAI Codex', 'CX', '#111111', 'codex-color.svg', ['codex']),
  brandIdentity('gemini-cli', 'Gemini CLI', 'GC', '#4285f4', 'geminicli-color.svg', ['gemini-cli', 'geminicli']),
  brandIdentity('github-copilot', 'GitHub Copilot', 'GH', '#24292f', 'githubcopilot.svg', ['github', 'githubcopilot']),
  brandIdentity('cursor', 'Cursor', 'CU', '#111111', 'cursor.svg', ['cursor']),
  brandIdentity('antigravity', 'Antigravity', 'AG', '#f59e0b', 'antigravity-color.svg', ['antigravity']),
  brandIdentity('kilocode', 'Kilo Code', 'KC', '#ff6b35', 'kilocode.svg', ['kilocode', 'kilo code']),
  brandIdentity('cline', 'Cline', 'CL', '#5b9bd5', 'cline.svg', ['cline']),
  brandIdentity('qoder', 'Qoder', 'QD', '#6366f1', 'qoder-color.svg', ['qoder']),
  brandIdentity('windsurf', 'Windsurf', 'WS', '#00c5a0', 'windsurf.svg', ['windsurf']),
  brandIdentity('gitlab-duo', 'GitLab Duo', 'GL', '#fc6d26', 'gitlab-color.svg', ['gitlab-duo', 'gitlab duo']),
  brandIdentity('amazon-q', 'Amazon Q', 'AQ', '#ff9900', 'amazonq-color.svg', ['amazon-q', 'amazon q']),
  brandIdentity('trae', 'Trae', 'TR', '#ff7849', 'trae-color.svg', ['trae']),
  brandIdentity('grok-cli', 'Grok Build', 'GB', '#111111', 'grok.svg', ['grok-cli', 'grok build']),
  brandIdentity('codebuddy-cn', 'CodeBuddy CN', 'CB', '#006eff', 'codebuddy-color.svg', ['codebuddy-cn', 'codebuddy']),
  brandIdentity('official', 'Claude', 'C', '#d97757', 'claude-color.svg', ['official', 'claude']),
  brandIdentity('anthropic-api', 'Anthropic API', 'AN', '#111111', 'anthropic.svg', ['anthropic-api', 'anthropic', 'api.anthropic.com'], 0.68),
  brandIdentity('deepseek', 'DeepSeek', 'DS', '#4d6bfe', 'deepseek-color.svg', ['deepseek']),
  brandIdentity('zhipuglm', 'GLM', 'GL', '#2563eb', 'zhipu-color.svg', ['zhipuglm', 'zhipu', 'bigmodel', 'chatglm', 'glm']),
  brandIdentity('kimi-code', 'Kimi Code', 'K', '#111111', 'kimi-color.svg', ['kimi-code', 'kimicode'], 0.72, '#111111'),
  brandIdentity('kimi', 'Kimi', 'K', '#111111', 'kimi-color.svg', ['kimi', 'moonshot'], 0.72, '#111111'),
  brandIdentity('minimax', 'MiniMax', 'MM', '#ef4444', 'minimax-color.svg', ['minimax', 'minimaxi']),
  brandIdentity('xiaomimimo', 'MiMo', 'MI', '#ff6900', 'xiaomimimo.svg', ['xiaomimimo', 'xiaomi', 'mimo']),
  brandIdentity('openai', 'OpenAI', 'OA', '#111111', 'openai.svg', ['openai', 'chatgpt', 'gpt4', 'gpt5', 'gptoss']),
  brandIdentity('google', 'Gemini', 'G', '#4285f4', 'gemini-color.svg', ['google', 'gemini', 'aistudio', 'generativelanguage']),
  brandIdentity('alibaba', 'Alibaba Cloud Bailian', 'AB', '#615ced', 'bailian-color.svg', ['alibaba', 'bailian', 'dashscope']),
  brandIdentity('sensenova', 'SenseNova', 'SN', '#1f6fff', 'sensenova.svg', ['sensenova', 'sense nova', '商汤']),
  brandIdentity('kie', 'KIE AI', 'KI', '#111827', 'kie.png', ['kie', 'kie.ai'], 0.78),
  brandIdentity('fal-ai', 'Fal AI', 'FA', '#111111', 'fal.svg', ['fal-ai', 'fal.ai', 'fal run'], 0.76),
  brandIdentity('recraft', 'Recraft', 'RC', '#111111', 'recraft.svg', ['recraft']),
  brandIdentity('ideogram', 'Ideogram', 'ID', '#111111', 'ideogram.svg', ['ideogram']),
  brandIdentity('leonardo', 'Leonardo AI', 'LE', '#5b21b6', 'leonardo.svg', ['leonardo']),
  brandIdentity('haiper', 'Haiper', 'HA', '#111111', 'haiper.svg', ['haiper']),
  brandIdentity('pollinations', 'Pollinations', 'PL', '#111111', 'pollinations.svg', ['pollinations']),
  brandIdentity('topaz', 'Topaz Labs', 'TZ', '#111111', 'topazlabs.svg', ['topaz', 'topazlabs']),
  brandIdentity('comfyui', 'ComfyUI', 'CU', '#111111', 'comfyui.svg', ['comfyui', 'comfy ui']),
  brandIdentity('runwayml', 'Runway', 'RW', '#111111', 'runway.svg', ['runwayml', 'runway']),
  brandIdentity('replicate', 'Replicate', 'RP', '#111111', 'replicate.svg', ['replicate'], 0.72, '#111111'),
  brandIdentity('tencent', 'Tencent Cloud', 'TC', '#0052d9', 'tencent.svg', ['tencent', '腾讯']),
  brandIdentity('veoaifree-web', 'Veo AI Free', 'VF', '#4285f4', 'veoaifree-web.svg', ['veoaifree-web', 'veoaifree']),
  brandIdentity('deepgram', 'Deepgram', 'DG', '#13ef93', 'deepgram.svg', ['deepgram']),
  brandIdentity('elevenlabs', 'ElevenLabs', '11', '#111111', 'elevenlabs.svg', ['elevenlabs', 'eleven labs']),
  brandIdentity('assemblyai', 'AssemblyAI', 'AA', '#6c47ff', 'assemblyai.svg', ['assemblyai', 'assembly ai']),
  brandIdentity('cartesia', 'Cartesia', 'CA', '#111111', 'cartesia.svg', ['cartesia']),
  brandIdentity('inworld', 'Inworld', 'IW', '#7157ff', 'inworld.svg', ['inworld']),
  brandIdentity('playht', 'PlayHT', 'PH', '#111111', 'playht.svg', ['playht', 'play.ht']),
  brandIdentity('qianfan', 'Baidu Qianfan', 'BQ', '#2563eb', 'baiducloud-color.svg', ['qianfan', 'baidubce', 'baidu', '千帆', '百度']),
  brandIdentity('meta-llama', 'Meta Llama API', 'ML', '#0668e1', 'meta-color.svg', ['meta-llama', 'meta', 'llama']),
  brandIdentity('perplexity', 'Perplexity', 'P', '#20808d', 'perplexity-color.svg', ['perplexity']),
  brandIdentity('cohere', 'Cohere', 'CO', '#39594d', 'cohere-color.svg', ['cohere']),
  brandIdentity('ai21', 'AI21 Labs', '21', '#111111', 'ai21-brand-color.svg', ['ai21'], 0.82),
  brandIdentity('openrouter', 'OpenRouter', 'OR', '#111827', 'openrouter-color.svg', ['openrouter']),
  brandIdentity('cloudflare-ai', 'Cloudflare Workers AI', 'CF', '#f38020', 'cloudflare.svg', ['cloudflare-ai', 'workers ai', 'api.cloudflare.com'], 0.82),
  brandIdentity('ollama-cloud', 'Ollama Cloud', 'OC', '#111827', 'ollama.svg', ['ollama-cloud', 'ollamacloud', 'ollama.com']),
  brandIdentity('llm7', 'LLM7.io', 'L7', '#7c3aed', 'llm7.svg', ['llm7', 'api.llm7.io'], 0.82),
  brandIdentity('synthetic', 'Synthetic', 'SY', '#6366f1', 'synthetic.svg', ['synthetic']),
  brandIdentity('kilo-gateway', 'Kilo Gateway', 'KG', '#617a91', 'kilo-gateway.svg', ['kilo-gateway', 'kilo gateway', 'api.kilo.ai']),
  brandIdentity('aimlapi', 'AI/ML API', 'AI', '#6366f1', 'aimlapi.png', ['aimlapi', 'ai/ml api'], 0.76),
  brandIdentity('novita', 'Novita AI', 'NV', '#ff4081', 'novita.svg', ['novita']),
  brandIdentity('piapi', 'PiAPI', 'PI', '#7c4dff', 'piapi.png', ['piapi'], 0.76),
  brandIdentity('vercel-ai-gateway', 'Vercel AI Gateway', 'VG', '#111111', 'vercel.svg', ['vercel-ai-gateway', 'vercel ai gateway', 'ai-gateway.vercel.sh'], 0.68),
  brandIdentity('agentrouter', 'AgentRouter', 'AR', '#10b981', 'agentrouter.png', ['agentrouter'], 0.76),
  brandIdentity('empower', 'Empower', 'EM', '#14b8a6', 'empower.png', ['empower'], 0.76),
  brandIdentity('poe', 'Poe', 'PO', '#5d3fd3', 'poe.svg', ['poe', 'api.poe.com']),
  brandIdentity('chutes', 'Chutes.ai', 'CH', '#06b6d4', 'chutes.svg', ['chutes', 'chutesai']),
  brandIdentity('hackclub', 'Hack Club AI', 'HC', '#ec3750', 'hackclub.svg', ['hackclub', 'hack club']),
  brandIdentity('nanogpt', 'NanoGPT', 'NG', '#4f46e5', 'nanogpt.png', ['nanogpt', 'nano-gpt'], 0.76),
  brandIdentity('groq', 'Groq', 'GQ', '#f55036', 'groq.svg', ['groq']),
  brandIdentity('mistral', 'Mistral', 'M', '#f59e0b', 'mistral-color.svg', ['mistral', 'codestral', 'mixtral']),
  brandIdentity('reka', 'Reka AI', 'R', '#111827', 'reka.png', ['reka'], 0.78),
  brandIdentity('cerebras', 'Cerebras', 'C', '#f97316', 'cerebras-color.svg', ['cerebras']),
  brandIdentity('nvidia', 'NVIDIA', 'NV', '#76b900', 'nvidia-color.svg', ['nvidia', 'nim']),
  brandIdentity('sambanova', 'SambaNova', 'SN', '#ef4444', 'sambanova-color.svg', ['sambanova']),
  brandIdentity('siliconflow', 'SiliconFlow', 'SF', '#6e29f6', 'siliconcloud-color.svg', ['siliconflow', 'siliconcloud']),
  brandIdentity('github-models', 'GitHub Models', 'GH', '#24292f', 'github.svg', ['github-models', 'githubmodels', 'models.github.ai']),
  brandIdentity('huggingface', 'Hugging Face', 'HF', '#ffcc4d', 'huggingface-color.svg', ['huggingface', 'hugging face']),
  brandIdentity('fireworks', 'Fireworks AI', 'FW', '#6d28d9', 'fireworks-color.svg', ['fireworks']),
  brandIdentity('deepinfra', 'DeepInfra', 'DI', '#2563eb', 'deepinfra-color.svg', ['deepinfra']),
  brandIdentity('openvecta', 'OpenVecta', 'OV', '#111827', 'openvecta.svg', ['openvecta']),
  brandIdentity('hyperbolic', 'Hyperbolic', 'H', '#f97316', 'hyperbolic-color.svg', ['hyperbolic']),
  brandIdentity('nebius', 'Nebius', 'N', '#ff5c35', 'nebius.svg', ['nebius']),
  brandIdentity('modelscope', 'ModelScope', 'MS', '#624aff', 'modelscope-color.svg', ['modelscope']),
  brandIdentity('nous-research', 'Nous Research', 'NR', '#111827', 'nousresearch.svg', ['nous-research', 'nousresearch', 'nous']),
  brandIdentity('friendliai', 'FriendliAI', 'F', '#7c3aed', 'friendli.svg', ['friendliai', 'friendli']),
  brandIdentity('featherless-ai', 'Featherless AI', 'FA', '#f0b429', 'featherless-color.svg', ['featherless-ai', 'featherless']),
  brandIdentity('pioneer', 'Pioneer AI', 'P', '#111827', 'pioneer.svg', ['pioneer']),
  brandIdentity('bytez', 'Bytez', 'B', '#2563eb', 'bytez.svg', ['bytez']),
  brandIdentity('opencode-free', 'OpenCode Free', 'OC', '#b7b1b1', 'opencode.svg', ['opencode-free', 'opencode.ai']),
  brandIdentity('lmstudio', 'LM Studio', 'LM', '#111827', 'lmstudio.svg', ['lmstudio', 'lm studio']),
  brandIdentity('ollama', 'Ollama', 'OL', '#111827', 'ollama.svg', ['ollama']),
  brandIdentity('volcengine', 'Volcengine', 'VE', '#1664ff', 'volcengine-color.svg', ['volcengine', 'volces', '火山']),
  brandIdentity('qwen', 'Qwen', 'Q', '#615ced', 'qwen-color.svg', ['qwen', 'tongyi']),
  brandIdentity('xai', 'xAI', 'X', '#111827', 'xai.svg', ['xai', 'grok']),
  {
    id: 'getgoapi',
    label: 'GoAPI',
    initials: 'GO',
    accent: '#ff6d00',
    motif: 'monogram',
    matchers: ['getgoapi', 'api.getgoapi.com'],
  },
  {
    id: 'laozhang',
    label: 'LaoZhang AI',
    initials: 'LZ',
    accent: '#ff1744',
    motif: 'monogram',
    matchers: ['laozhang'],
  },
  {
    id: 'thebai',
    label: 'TheB.AI',
    initials: 'TB',
    accent: '#3b82f6',
    motif: 'monogram',
    matchers: ['thebai', 'theb.ai'],
  },
  {
    id: 'fenayai',
    label: 'FenayAI',
    initials: 'FN',
    accent: '#ff9800',
    motif: 'monogram',
    matchers: ['fenayai'],
  },
  {
    id: 'atlascloud',
    label: 'Atlas Cloud',
    initials: 'AC',
    accent: '#2563eb',
    motif: 'monogram',
    matchers: ['atlascloud', 'atlas cloud'],
  },
  {
    id: 'freetheai',
    label: 'FreeTheAi',
    initials: 'FA',
    accent: '#22c55e',
    motif: 'monogram',
    matchers: ['freetheai'],
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
  if (input.identityPriority === 'model') {
    const modelIdentity = findMatchingIdentity(input.modelId)
    if (modelIdentity) return stripMatchers(modelIdentity)
  }

  const exactProviderId = compactIdentityToken(input.providerId)
  if (exactProviderId) {
    const canonicalProviderId = compactIdentityToken(
      EXACT_PROVIDER_ID_ALIASES[exactProviderId] ?? exactProviderId,
    )
    const exact = KNOWN_PROVIDER_IDENTITIES.find(
      (identity) => compactIdentityToken(identity.id) === canonicalProviderId,
    )
    if (exact) return stripMatchers(exact)
  }

  const hostnameIdentity = findMatchingIdentity(getBaseUrlHostname(input.baseUrl))
  if (hostnameIdentity) return stripMatchers(hostnameIdentity)

  const nameIdentity = findMatchingIdentity(input.name)
  if (nameIdentity) return stripMatchers(nameIdentity)

  const modelIdentity = findMatchingIdentity(input.modelId)
  if (modelIdentity) return stripMatchers(modelIdentity)

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

function findMatchingIdentity(value: string | null | undefined): ProviderIdentityDefinition | null {
  const haystack = compactIdentityToken(value)
  if (!haystack) return null

  let bestMatch: ProviderIdentityDefinition | null = null
  let bestScore = 0

  for (const identity of KNOWN_PROVIDER_IDENTITIES) {
    for (const matcher of identity.matchers) {
      const token = compactIdentityToken(matcher)
      if (token.length <= bestScore || !haystack.includes(token)) continue
      bestMatch = identity
      bestScore = token.length
    }
  }

  return bestMatch
}

function getBaseUrlHostname(value: string | null | undefined): string {
  const trimmed = value?.trim()
  if (!trimmed) return ''

  try {
    return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname
  } catch {
    return ''
  }
}

function hashProviderName(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash
}
