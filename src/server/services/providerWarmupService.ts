/**
 * Provider warmup — pre-loads local inference models in the background.
 *
 * Local servers (ollama, llama.cpp) spend 30-60s cold-loading a model on the
 * first request. When the user selects a model, the desktop fires this
 * endpoint so the model is already hot by the time the first prompt arrives.
 */

import {
  isLocalInferenceProvider,
  isOllamaProvider,
  resolveOllamaKeepAlive,
} from '../../utils/localModelPerformance.js'
import { logForDebugging } from '../../utils/debug.js'
import { buildOpenAICompatibleUrl } from '../proxy/openaiCompatUrl.js'
import type { SavedProvider } from '../types/provider.js'

// Model loads are slow; the warmup request gets the same generous budget as
// the local streaming TTFB override (180s default there).
const WARMUP_TIMEOUT_MS = 180_000

export type WarmupStartResult =
  | { ok: true, started: boolean, model: string }
  | { ok: false, reason: string }

// In-process dedupe: one warmup per provider+model at a time.
const inFlightWarmups = new Map<string, Promise<void>>()

export function startProviderWarmup(
  provider: SavedProvider,
  modelId?: string,
): WarmupStartResult {
  if (!isLocalInferenceProvider(provider)) {
    return { ok: false, reason: 'provider is not a local inference provider' }
  }
  const model = modelId?.trim() || provider.models.main
  if (!model) {
    return { ok: false, reason: 'no model configured for warmup' }
  }

  const key = `${provider.id}:${model}`
  if (inFlightWarmups.has(key)) {
    return { ok: true, started: false, model }
  }

  const task = runProviderWarmup(provider, model)
    .finally(() => {
      inFlightWarmups.delete(key)
    })
  inFlightWarmups.set(key, task)
  // Fire-and-forget: runProviderWarmup never rejects.
  void task
  return { ok: true, started: true, model }
}

async function runProviderWarmup(
  provider: SavedProvider,
  model: string,
): Promise<void> {
  const label = `[provider-warmup] ${provider.name} (${provider.id}) model=${model}`
  try {
    const baseUrl = provider.baseUrl.replace(/\/+$/, '')
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (provider.apiKey.trim()) {
      headers.Authorization = `Bearer ${provider.apiKey}`
    }

    let url: string
    let body: Record<string, unknown>
    if (isOllamaProvider(provider)) {
      // An empty-prompt generate call loads the model without producing output.
      let origin = baseUrl
      try {
        origin = new URL(baseUrl).origin
      } catch { /* keep trimmed baseUrl */ }
      url = `${origin}/api/generate`
      body = {
        model,
        prompt: '',
        stream: false,
        keep_alive: resolveOllamaKeepAlive(provider) ?? '30m',
      }
    } else {
      url = buildOpenAICompatibleUrl(baseUrl, 'chat/completions')
      body = {
        model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      }
    }

    logForDebugging(`${label} started via ${url}`)
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(WARMUP_TIMEOUT_MS),
    })
    await response.body?.cancel().catch(() => {})
    if (response.ok) {
      logForDebugging(`${label} completed (HTTP ${response.status})`)
    } else {
      logForDebugging(`${label} upstream returned HTTP ${response.status}`, { level: 'warn' })
    }
  } catch (error) {
    logForDebugging(
      `${label} failed: ${error instanceof Error ? error.message : String(error)}`,
      { level: 'warn' },
    )
  }
}
