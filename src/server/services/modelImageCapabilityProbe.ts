import type { SavedProvider } from '../types/provider.js'
import { buildOpenAICompatibleUrl } from '../proxy/openaiCompatUrl.js'
import {
  recordLearnedImageSupport,
  type LearnedImageSupport,
  type LearnedImageSupportSource,
} from '../../utils/model/imageCapabilityRegistry.js'
import {
  resolveProviderImageSupport,
  type ImageSupportResolution,
} from './modelImageSupport.js'

type ProbeResult = {
  status: LearnedImageSupport | 'unknown'
  source: LearnedImageSupportSource
  detail?: string
}

type ProbeOptions = {
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

const PROBE_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAJQAAAAwCAYAAAD3sVMsAAAA8ElEQVR4Ae3BsS3EcQCG4fe+UCh0LgaQuAWYQgwgUSpFZwqdKJUSA4gpzgInMYCcTqFQnJvgJ//kK9/nmW22kEqCVBSkoiAVBakoSEU7/ONjsWCKo9WKkfXFPlPMn78ZWd7tMsXp7S8jh09nTPF5+crI3v0LU/zcnDNyfPXFFO+PB4w8nKyZ4vptzkiQioJUFKSiIBUFqShIRUEqClJRkIqCVBSkoiAVBakoSEVBKgpSUZCKglQUpKIgFQWpKEhFQSoKUlGQioJUFKSiIBUFqShIRUEqClJRkIqCVBSkotlmC6kkSEVBKgpSUZCKglT0B0kfHVmUN/WnAAAAAElFTkSuQmCC'
const PROBE_PROMPT =
  'Count the distinct vertical colored bars in the image. Reply with only the number.'

export function isImageInputUnsupportedError(message: string): boolean {
  const normalized = message.replace(/\s+/g, ' ').trim()
  if (!normalized) return false

  return (
    /(?:image|vision|multimodal|visual).{0,80}(?:not supported|unsupported|does not support|not available|cannot accept|can't accept|text[- ]only)/i.test(normalized) ||
    /(?:not supported|unsupported|does not support|not available|invalid input modality).{0,80}(?:image|vision|multimodal|visual)/i.test(normalized) ||
    /(?:image_url|input_image|image source|image block).{0,80}(?:invalid|not allowed|not supported|unsupported|only supported)/i.test(normalized) ||
    /(?:图片|图像|视觉|多模态).{0,40}(?:不支持|无法|不能|不可用)/i.test(normalized) ||
    /(?:不支持|无法|不能).{0,40}(?:图片|图像|视觉|多模态)/i.test(normalized)
  )
}

function isOllamaProvider(provider: SavedProvider): boolean {
  if (provider.presetId === 'ollama') return true
  try {
    return new URL(provider.baseUrl).port === '11434'
  } catch {
    return false
  }
}

function isLmStudioProvider(provider: SavedProvider): boolean {
  if (provider.presetId === 'lmstudio') return true
  try {
    return new URL(provider.baseUrl).port === '1234'
  } catch {
    return false
  }
}

function providerOrigin(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin
  } catch {
    return baseUrl.replace(/\/+$/, '')
  }
}

function buildAnthropicMessagesUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  try {
    const parsed = new URL(base)
    const path = parsed.pathname.replace(/\/+$/, '')
    parsed.search = ''
    parsed.hash = ''
    if (/\/v1\/messages$/i.test(path)) return parsed.toString()
    parsed.pathname = /\/v1$/i.test(path)
      ? `${path}/messages`
      : `${path}/v1/messages`
    return parsed.toString()
  } catch {
    if (/\/v1\/messages$/i.test(base)) return base
    return /\/v1$/i.test(base) ? `${base}/messages` : `${base}/v1/messages`
  }
}

function capabilityList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string')
  }
  if (!value || typeof value !== 'object') return undefined

  const record = value as Record<string, unknown>
  const explicit: string[] = []
  for (const [key, enabled] of Object.entries(record)) {
    if (enabled === true) explicit.push(key)
  }
  return explicit.length > 0 || Object.values(record).some((item) => item === false)
    ? explicit
    : undefined
}

function listHasVision(capabilities: string[]): boolean {
  return capabilities.some((item) =>
    /^(?:vision|image|images|image_input|input_image|multimodal)$/i.test(item.trim()),
  )
}

async function probeOllamaMetadata(
  provider: SavedProvider,
  modelId: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<ProbeResult> {
  try {
    const response = await fetchImpl(`${providerOrigin(provider.baseUrl)}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelId }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return { status: 'unknown', source: 'local-metadata' }

    const body = await response.json() as Record<string, unknown>
    const capabilities = capabilityList(body.capabilities)
    if (!capabilities) return { status: 'unknown', source: 'local-metadata' }
    return {
      status: listHasVision(capabilities) ? 'supported' : 'unsupported',
      source: 'local-metadata',
    }
  } catch (error) {
    return {
      status: 'unknown',
      source: 'local-metadata',
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

function getLmStudioModels(body: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(body)) {
    return body.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
  }
  if (!body || typeof body !== 'object') return []
  const record = body as Record<string, unknown>
  const list = Array.isArray(record.models)
    ? record.models
    : Array.isArray(record.data)
      ? record.data
      : []
  return list.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
}

async function probeLmStudioMetadata(
  provider: SavedProvider,
  modelId: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<ProbeResult> {
  try {
    const response = await fetchImpl(`${providerOrigin(provider.baseUrl)}/api/v1/models`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return { status: 'unknown', source: 'local-metadata' }

    const models = getLmStudioModels(await response.json())
    const target = modelId.trim().toLowerCase()
    const model = models.find((item) =>
      [item.id, item.key, item.model, item.name]
        .some((value) => typeof value === 'string' && value.trim().toLowerCase() === target),
    )
    if (!model) return { status: 'unknown', source: 'local-metadata' }

    const capabilities = capabilityList(model.capabilities)
    if (!capabilities) return { status: 'unknown', source: 'local-metadata' }
    return {
      status: listHasVision(capabilities) ? 'supported' : 'unsupported',
      source: 'local-metadata',
    }
  } catch (error) {
    return {
      status: 'unknown',
      source: 'local-metadata',
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

function buildImageProbeRequest(provider: SavedProvider, modelId: string): {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
} {
  const base = provider.baseUrl.replace(/\/+$/, '')
  const apiKey = provider.apiKey || 'local-provider'
  const dataUrl = `data:image/png;base64,${PROBE_IMAGE_BASE64}`

  if (provider.apiFormat === 'openai_chat') {
    return {
      url: buildOpenAICompatibleUrl(base, 'chat/completions'),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: {
        model: modelId,
        max_tokens: 16,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            { type: 'text', text: PROBE_PROMPT },
          ],
        }],
      },
    }
  }

  if (provider.apiFormat === 'openai_responses') {
    return {
      url: buildOpenAICompatibleUrl(base, 'responses'),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: {
        model: modelId,
        max_output_tokens: 16,
        input: [{
          role: 'user',
          content: [
            { type: 'input_image', image_url: dataUrl },
            { type: 'input_text', text: PROBE_PROMPT },
          ],
        }],
      },
    }
  }

  return {
    url: buildAnthropicMessagesUrl(base),
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: {
      model: modelId,
      max_tokens: 16,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: PROBE_IMAGE_BASE64 },
          },
          { type: 'text', text: PROBE_PROMPT },
        ],
      }],
    },
  }
}

function extractResponseText(raw: string): string {
  if (!raw.trim()) return ''
  try {
    const body = JSON.parse(raw) as Record<string, unknown>
    const candidates = [
      body.message,
      body.detail,
      body.error,
      body.errors,
    ]
    return candidates
      .map((value) => {
        if (typeof value === 'string') return value
        if (value && typeof value === 'object') return JSON.stringify(value)
        return ''
      })
      .filter(Boolean)
      .join(' ')
      .slice(0, 2000)
  } catch {
    return raw.slice(0, 2000)
  }
}

function textFromContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return ''
      const record = item as Record<string, unknown>
      if (typeof record.text === 'string') return record.text
      return textFromContent(record.content)
    })
    .filter(Boolean)
    .join(' ')
}

function extractProbeOutputText(raw: string): string {
  if (!raw.trim()) return ''
  try {
    const body = JSON.parse(raw) as Record<string, unknown>
    const choices = Array.isArray(body.choices) ? body.choices : []
    const output = Array.isArray(body.output) ? body.output : []
    return [
      typeof body.output_text === 'string' ? body.output_text : '',
      textFromContent(body.content),
      ...choices.map((choice) => {
        if (!choice || typeof choice !== 'object') return ''
        const message = (choice as Record<string, unknown>).message
        if (!message || typeof message !== 'object') return ''
        return textFromContent((message as Record<string, unknown>).content)
      }),
      ...output.map((item) => {
        if (!item || typeof item !== 'object') return ''
        return textFromContent((item as Record<string, unknown>).content)
      }),
    ].filter(Boolean).join(' ').trim()
  } catch {
    return ''
  }
}

function passedVisionChallenge(output: string): boolean {
  const normalized = output.trim().toLowerCase().replace(/[\s.!。！]+/g, '')
  return normalized === '7' || normalized === 'seven' || normalized === '七'
}

export async function probeProviderImageSupport(
  provider: SavedProvider,
  modelId: string,
  options: ProbeOptions = {},
): Promise<ProbeResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 8000

  if (isOllamaProvider(provider)) {
    const metadata = await probeOllamaMetadata(provider, modelId, fetchImpl, timeoutMs)
    if (metadata.status !== 'unknown') return metadata
  }

  if (isLmStudioProvider(provider)) {
    const metadata = await probeLmStudioMetadata(provider, modelId, fetchImpl, timeoutMs)
    if (metadata.status !== 'unknown') return metadata
  }

  try {
    const request = buildImageProbeRequest(provider, modelId)
    const response = await fetchImpl(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const raw = await response.text().catch(() => '')
    const detail = extractResponseText(raw)

    if (isImageInputUnsupportedError(detail)) {
      return { status: 'unsupported', source: 'probe', detail }
    }
    if (response.ok) {
      const output = extractProbeOutputText(raw)
      if (passedVisionChallenge(output)) {
        return { status: 'supported', source: 'probe' }
      }
      return {
        status: 'unknown',
        source: 'probe',
        detail: output
          ? `Vision challenge returned an unexpected answer: ${output.slice(0, 200)}`
          : 'Vision challenge returned no readable answer.',
      }
    }
    return { status: 'unknown', source: 'probe', detail }
  } catch (error) {
    return {
      status: 'unknown',
      source: 'probe',
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function resolveProviderImageSupportDynamically(
  provider: SavedProvider | null | undefined,
  modelId?: string,
  options: ProbeOptions = {},
): Promise<ImageSupportResolution> {
  const initial = resolveProviderImageSupport(provider, modelId)
  if (!provider || !initial.modelId) return initial
  if (
    initial.source === 'provider-forced' ||
    initial.source === 'provider-legacy' ||
    initial.source === 'learned'
  ) {
    return initial
  }

  // Local runtimes expose the capabilities of the model that is actually
  // installed, so their metadata must win over optimistic preset/catalog data.
  // For remote providers, trust explicit provider metadata and built-in
  // catalogs; model-id inference still needs the visual challenge below.
  const hasLocalCapabilityMetadata = isOllamaProvider(provider) || isLmStudioProvider(provider)
  if (
    !hasLocalCapabilityMetadata &&
    initial.status === 'supported' &&
    (initial.source === 'provider-catalog' ||
      initial.source === 'preset-model' ||
      initial.source === 'preset')
  ) {
    return initial
  }

  const probed = await probeProviderImageSupport(provider, initial.modelId, options)
  if (probed.status === 'unknown') {
    return initial.status === 'supported'
      ? { ...initial, supportsImages: false, status: 'unknown' }
      : initial
  }

  recordLearnedImageSupport({
    baseUrl: provider.baseUrl,
    modelId: initial.modelId,
    status: probed.status,
    source: probed.source,
  })
  return resolveProviderImageSupport(provider, initial.modelId)
}
