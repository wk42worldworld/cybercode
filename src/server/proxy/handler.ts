/**
 * Proxy Handler — protocol-translating reverse proxy for OpenAI-compatible APIs.
 *
 * Receives Anthropic Messages API requests from the CLI, transforms them to
 * OpenAI Chat Completions or Responses API format, forwards to the upstream
 * provider, and transforms the response back to Anthropic format.
 *
 * Derived from cc-switch (https://github.com/farion1231/cc-switch)
 * Original work by Jason Young, MIT License
 */

import { ProviderService } from '../services/providerService.js'
import { anthropicToOpenaiChat } from './transform/anthropicToOpenaiChat.js'
import { anthropicToOpenaiResponses } from './transform/anthropicToOpenaiResponses.js'
import { openaiChatToAnthropic } from './transform/openaiChatToAnthropic.js'
import { openaiResponsesToAnthropic } from './transform/openaiResponsesToAnthropic.js'
import { openaiChatStreamToAnthropic } from './streaming/openaiChatStreamToAnthropic.js'
import { openaiResponsesStreamToAnthropic } from './streaming/openaiResponsesStreamToAnthropic.js'
import { buildOpenAICompatibleUrl } from './openaiCompatUrl.js'
import type {
  AnthropicRequest,
  OpenAIChatRequest,
  OpenAIChatResponse,
  OpenAIToolCall,
} from './transform/types.js'
import { isKimiBaseUrl } from '../../utils/model/kimi.js'
import { logForDebugging } from '../../utils/debug.js'
import { routingService, type ResolvedRouteTarget } from '../routing/routingService.js'
import type { SavedProvider } from '../types/provider.js'
import { ApiError } from '../middleware/errorHandler.js'
import {
  providerOAuthService,
  type ProviderRuntimeAuth,
} from '../services/providerOAuthService.js'
import {
  prepareCodexResponsesRequest,
  readCodexResponsesCompletion,
} from './codexResponses.js'
import { prepareGrokBuildResponsesRequest } from './grokBuildResponses.js'
import { executeNativeOAuthChat } from './nativeOAuth/index.js'
import {
  handleWebSessionRequest,
  isWebSessionProvider,
} from './webSession/handler.js'
import { sanitizeErrorMessage } from './webSession/vendor/omniroute/open-sse/utils/error.js'
import { prepareAnthropicRequestForProvider } from './localModelPerformance.js'
import { executeRouteGraph } from './routeGraphExecutor.js'
import { isLocalInferenceProvider, resolveOllamaKeepAlive } from '../../utils/localModelPerformance.js'

const providerService = new ProviderService()

// Streaming upstreams get 30s to send response headers. Local inference
// servers (ollama, llama.cpp, ...) routinely spend 30-60s cold-loading a
// model before the first byte, so they get a much longer TTFB budget.
const STREAM_TTFB_TIMEOUT_MS = 30_000
const DEFAULT_LOCAL_STREAM_TTFB_TIMEOUT_MS = 180_000

function localStreamTtfbTimeoutMs(): number {
  const override = Number.parseInt(
    process.env.CYBERCODE_LOCAL_STREAM_TTFB_TIMEOUT_MS ?? '',
    10,
  )
  return Number.isFinite(override) && override > 0
    ? override
    : DEFAULT_LOCAL_STREAM_TTFB_TIMEOUT_MS
}

// Local upstreams cannot recover from a timed-out cold load by retrying —
// each retry replays the full prompt against the same loading model. Tell
// the client's retry loop not to amplify the failure.
const NO_RETRY_HEADERS = { 'x-should-retry': 'false' } as const

// Raw local-upstream errors ("fetch failed", "This operation was aborted")
// are meaningless to end users. Wrap them in actionable guidance that names
// the server address and suggests the fix.
function localUpstreamErrorMessage(err: unknown, baseUrl: string, model?: string): string {
  const raw = err instanceof Error ? err.message : String(err)
  const name = err instanceof Error ? err.name : ''
  const cause = err instanceof Error ? (err as { cause?: unknown }).cause : undefined
  const causeCode = cause && typeof cause === 'object'
    ? String((cause as { code?: unknown }).code ?? '')
    : ''
  const modelSuffix = model ? ` (model: ${model})` : ''
  if (name === 'AbortError' || name === 'TimeoutError' || /abort/i.test(raw)) {
    const timeoutSeconds = Math.round(localStreamTtfbTimeoutMs() / 1000)
    return `Local model at ${baseUrl}${modelSuffix} did not respond within ${timeoutSeconds}s. The model may still be loading, or the server is overloaded. Try again, or increase CYBERCODE_LOCAL_STREAM_TTFB_TIMEOUT_MS.`
  }
  if (
    /fetch failed|econnrefused|enotfound|econnreset|connection refused|socket hang up/i.test(raw) ||
    ['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET'].includes(causeCode)
  ) {
    return `Cannot connect to local model server at ${baseUrl}${modelSuffix}. Make sure the server is running (e.g. \`ollama serve\`) and the address is correct.`
  }
  return `Local model request failed: ${raw}. Check the local model server at ${baseUrl}${modelSuffix}.`
}

export async function handleProxyRequest(req: Request, url: URL): Promise<Response> {
  const providerMatch = url.pathname.match(/^\/proxy\/providers\/([^/]+)\/v1\/messages$/)
  const providerId = providerMatch ? decodeURIComponent(providerMatch[1]!) : undefined
  const routeMatch = url.pathname.match(
    /^\/proxy\/routes\/([^/]+)\/sessions\/([^/]+)\/v1\/messages$/,
  )
  const isActiveProxyPath = url.pathname === '/proxy/v1/messages'

  if (req.method !== 'POST' || (!isActiveProxyPath && !providerMatch && !routeMatch)) {
    return Response.json(
      {
        error: 'Not Found',
        message: 'Unsupported provider proxy path',
      },
      { status: 404 },
    )
  }

  let body: AnthropicRequest
  try {
    body = (await req.json()) as AnthropicRequest
  } catch {
    return Response.json(
      { type: 'error', error: { type: 'invalid_request_error', message: 'Invalid JSON in request body' } },
      { status: 400 },
    )
  }

  if (routeMatch) {
    const routeId = decodeURIComponent(routeMatch[1]!)
    const sessionId = decodeURIComponent(routeMatch[2]!)
    return handleRoutedRequest(req, routeId, sessionId, body)
  }

  // Read active/default provider config or an explicitly-scoped provider config.
  const config = await providerService.getProviderForProxy(providerId)
  if (!config) {
    return Response.json(
      {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: providerId
            ? `Provider "${providerId}" is not configured for proxy`
            : 'No active provider configured for proxy',
        },
      },
      { status: 400 },
    )
  }

  if (isWebSessionProvider(config)) {
    try {
      return await handleWebSessionRequest(config, body, req.signal)
    } catch (err) {
      if (req.signal.aborted) return clientCancelledResponse()
      return Response.json(
        {
          type: 'error',
          error: {
            type: 'api_error',
            message: sanitizeErrorMessage(err),
          },
        },
        { status: 502 },
      )
    }
  }

  if (config.apiFormat === 'anthropic' && !providerId) {
    return Response.json(
      {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: providerId
            ? `Provider "${providerId}" uses anthropic format — proxy not needed`
            : 'Active provider uses anthropic format — proxy not needed',
        },
      },
      { status: 400 },
    )
  }

  const preparedRequest = prepareAnthropicRequestForProvider(config, body)
  const requestBody = preparedRequest.body
  const isStream = requestBody.stream === true
  const baseUrl = config.baseUrl.replace(/\/+$/, '')
  if (
    config.oauthProviderId &&
    !providerOAuthService.matchesRuntimeTarget(
      config.oauthProviderId,
      baseUrl,
      config.apiFormat,
    )
  ) {
    return invalidOAuthTargetResponse(config.oauthProviderId)
  }
  const runtimeAuth = config.oauthProviderId
    ? await providerOAuthService.runtimeAuth(config.oauthProviderId)
    : null
  if (config.oauthProviderId && !runtimeAuth) {
    return Response.json(
      {
        type: 'error',
        error: {
          type: 'authentication_error',
          message: `OAuth connection "${config.oauthProviderId}" is unavailable. Reconnect it in Settings.`,
        },
      },
      { status: 401 },
    )
  }
  const apiKey = runtimeAuth?.token ?? config.apiKey
  const runtimeHeaders = runtimeAuth?.headers

  try {
    if (config.apiFormat === 'anthropic') {
      return await forwardAnthropic(
        req,
        config,
        requestBody,
        apiKey,
        runtimeHeaders,
      )
    } else if (config.apiFormat === 'openai_chat') {
      return await handleOpenaiChat(
        requestBody,
        baseUrl,
        apiKey,
        isStream,
        req.signal,
        runtimeHeaders,
        config.oauthProviderId,
        runtimeAuth ?? undefined,
        preparedRequest.localModelPerformance,
        resolveOllamaKeepAlive(config),
      )
    } else {
      return await handleOpenaiResponses(
        requestBody,
        baseUrl,
        apiKey,
        isStream,
        req.signal,
        runtimeHeaders,
        config.oauthProviderId,
        preparedRequest.localModelPerformance,
      )
    }
  } catch (err) {
    if (req.signal.aborted) return clientCancelledResponse()
    logForDebugging(
      `[provider-proxy] upstream request failed: ${err instanceof Error ? err.message : String(err)}`,
      { level: 'error' },
    )
    const isLocal = preparedRequest.localModelPerformance
    return Response.json(
      {
        type: 'error',
        error: {
          type: 'api_error',
          message: isLocal
            ? localUpstreamErrorMessage(err, baseUrl, requestBody.model)
            : err instanceof Error ? err.message : String(err),
        },
      },
      {
        status: 502,
        headers: isLocal ? NO_RETRY_HEADERS : undefined,
      },
    )
  }
}

async function handleRoutedRequest(
  req: Request,
  routeId: string,
  sessionId: string,
  body: AnthropicRequest,
): Promise<Response> {
  let plan: Awaited<ReturnType<typeof routingService.resolveAttempts>>
  try {
    plan = await routingService.resolveAttempts(routeId, sessionId, body)
  } catch (error) {
    const status = error instanceof ApiError ? error.statusCode : 500
    return Response.json(
      {
        type: 'error',
        error: {
          type: status < 500 ? 'invalid_request_error' : 'api_error',
          message: error instanceof Error ? error.message : String(error),
        },
      },
      { status },
    )
  }

  if (plan.graphPlan) {
    return executeRouteGraph({
      routeId,
      sessionId,
      fingerprint: plan.fingerprint,
      body,
      plan: plan.graphPlan,
      signal: req.signal,
      forward: (target, routedBody, signal) => (
        forwardToTarget(req, target, routedBody, signal)
      ),
      prime: (response, stream) => (
        stream ? primeStreamingResponse(response) : primeNonStreamingResponse(response)
      ),
      isRetryableStatus: (status) => routingService.isRetryableStatus(status),
      recordSuccess: (input) => routingService.recordSuccess(input),
      recordFailure: (input) => routingService.recordFailure(input),
    })
  }

  let lastError = 'No route candidate was attempted'
  for (let index = 0; index < plan.targets.length; index += 1) {
    if (req.signal.aborted) return clientCancelledResponse()
    const target = plan.targets[index]!
    const attempt = index + 1
    const startedAt = Date.now()
    const routedBody = { ...body, model: target.modelId }

    try {
      const response = await forwardToTarget(req, target, routedBody)
      if (req.signal.aborted) {
        await response.body?.cancel().catch(() => {})
        return clientCancelledResponse()
      }
      if (response.ok) {
        // Local targets cold-load models for 30-60s before the first byte —
        // the 30s first-chunk fuse in the prime helpers would cut them off.
        const readyResponse = isLocalInferenceProvider(target.provider)
          ? response
          : body.stream === true
            ? await primeStreamingResponse(response)
            : await primeNonStreamingResponse(response)
        const latencyMs = Date.now() - startedAt
        routingService.recordSuccess({
          routeId,
          sessionId,
          fingerprint: plan.fingerprint,
          target,
          latencyMs,
          attempt,
        })
        const headers = new Headers(readyResponse.headers)
        headers.set('x-cybercode-route', routeId)
        headers.set('x-cybercode-route-provider', target.provider.id)
        headers.set('x-cybercode-route-model', target.modelId)
        return new Response(readyResponse.body, { status: readyResponse.status, headers })
      }

      const latencyMs = Date.now() - startedAt
      const retryable = routingService.isRetryableStatus(response.status)
      lastError = `HTTP ${response.status}`
      routingService.recordFailure({
        routeId,
        sessionId,
        fingerprint: plan.fingerprint,
        target,
        latencyMs,
        attempt,
        error: lastError,
        retryable,
      })

      if (!retryable || index === plan.targets.length - 1) return response
      await response.body?.cancel().catch(() => {})
    } catch (error) {
      if (req.signal.aborted) return clientCancelledResponse()
      const latencyMs = Date.now() - startedAt
      lastError = error instanceof Error ? error.message : String(error)
      routingService.recordFailure({
        routeId,
        sessionId,
        fingerprint: plan.fingerprint,
        target,
        latencyMs,
        attempt,
        error: lastError,
        retryable: true,
      })
      if (index === plan.targets.length - 1) break
    }
  }

  return Response.json(
    {
      type: 'error',
      error: {
        type: 'api_error',
        message: `All route candidates failed: ${lastError}`,
      },
    },
    { status: 502 },
  )
}

function invalidOAuthTargetResponse(providerId: string): Response {
  return Response.json(
    {
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: `OAuth provider "${providerId}" has an invalid runtime target. Reconnect it in Settings.`,
      },
    },
    { status: 400 },
  )
}

function clientCancelledResponse(): Response {
  return Response.json(
    {
      type: 'error',
      error: {
        type: 'request_cancelled',
        message: 'The client cancelled the routed request',
      },
    },
    { status: 499 },
  )
}

async function forwardToTarget(
  req: Request,
  target: ResolvedRouteTarget,
  body: AnthropicRequest,
  signal: AbortSignal = req.signal,
): Promise<Response> {
  const provider = target.provider
  if (isWebSessionProvider(provider)) {
    return handleWebSessionRequest(provider, body, signal)
  }
  const preparedRequest = prepareAnthropicRequestForProvider(provider, body)
  const requestBody = preparedRequest.body
  if (
    provider.oauthProviderId &&
    !providerOAuthService.matchesRuntimeTarget(
      provider.oauthProviderId,
      provider.baseUrl,
      provider.apiFormat ?? 'anthropic',
    )
  ) {
    return invalidOAuthTargetResponse(provider.oauthProviderId)
  }
  const runtimeAuth = provider.oauthProviderId
    ? await providerOAuthService.runtimeAuth(provider.oauthProviderId)
    : null
  if (provider.oauthProviderId && !runtimeAuth) {
    return Response.json(
      {
        type: 'error',
        error: {
          type: 'authentication_error',
          message: `OAuth connection "${provider.oauthProviderId}" is unavailable.`,
        },
      },
      { status: 401 },
    )
  }
  const apiKey = runtimeAuth?.token ?? provider.apiKey
  if ((provider.apiFormat ?? 'anthropic') === 'anthropic') {
    return forwardAnthropic(
      req,
      provider,
      requestBody,
      apiKey,
      runtimeAuth?.headers,
      signal,
    )
  }

  const baseUrl = provider.baseUrl.replace(/\/+$/, '')
  if (provider.apiFormat === 'openai_chat') {
    return handleOpenaiChat(
      requestBody,
      baseUrl,
      apiKey,
      requestBody.stream === true,
      signal,
      runtimeAuth?.headers,
      provider.oauthProviderId,
      runtimeAuth ?? undefined,
      preparedRequest.localModelPerformance,
      resolveOllamaKeepAlive(provider),
    )
  }
  return handleOpenaiResponses(
    requestBody,
    baseUrl,
    apiKey,
    requestBody.stream === true,
    signal,
    runtimeAuth?.headers,
    provider.oauthProviderId,
    preparedRequest.localModelPerformance,
  )
}

function forwardAnthropic(
  req: Request,
  provider: SavedProvider,
  body: AnthropicRequest,
  apiKey = provider.apiKey,
  extraHeaders?: Record<string, string>,
  signal: AbortSignal = req.signal,
): Promise<Response> {
  const baseUrl = provider.baseUrl.replace(/\/+$/, '')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': req.headers.get('anthropic-version') || '2023-06-01',
  }
  if (apiKey.trim()) headers['x-api-key'] = apiKey
  const beta = req.headers.get('anthropic-beta')
  if (beta) headers['anthropic-beta'] = beta
  Object.assign(headers, extraHeaders)

  return fetchUpstream(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }, body.stream === true, signal, isLocalInferenceProvider(provider))
}

function buildOpenAICompatibleHeaders(
  baseUrl: string,
  apiKey: string,
  extraHeaders?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
  if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey}`
  try {
    const hostname = new URL(baseUrl).hostname
    if (hostname === 'openrouter.ai') {
      headers['HTTP-Referer'] = 'https://github.com/wk42worldworld/cybercode'
      headers['X-OpenRouter-Title'] = 'CyberCode'
    }
    if (hostname === 'models.github.ai') {
      headers.Accept = 'application/vnd.github+json'
    }
  } catch {
    // Custom local endpoints only need the generic compatibility headers.
  }
  Object.assign(headers, extraHeaders)
  return headers
}

async function fetchUpstream(
  url: string,
  init: RequestInit,
  isStream: boolean,
  requestSignal?: AbortSignal,
  isLocal = false,
): Promise<Response> {
  if (!isStream) {
    const timeoutSignal = AbortSignal.timeout(300_000)
    const signal = requestSignal
      ? AbortSignal.any([requestSignal, timeoutSignal])
      : timeoutSignal
    return fetch(url, { ...init, signal })
  }

  const controller = new AbortController()
  const ttfbTimeoutMs = isLocal
    ? localStreamTtfbTimeoutMs()
    : STREAM_TTFB_TIMEOUT_MS
  const timer = setTimeout(() => controller.abort(), ttfbTimeoutMs)
  const signal = requestSignal
    ? AbortSignal.any([requestSignal, controller.signal])
    : controller.signal
  try {
    return await fetch(url, { ...init, signal })
  } finally {
    clearTimeout(timer)
  }
}

async function primeStreamingResponse(response: Response): Promise<Response> {
  if (!response.body) throw new Error('Upstream returned no body for stream')
  const body = await primeAnthropicStream(response.body)
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

function hasMeaningfulAnthropicBlock(block: unknown): boolean {
  if (!block || typeof block !== 'object') return false
  const record = block as Record<string, unknown>
  if (
    typeof record.type === 'string' &&
    record.type !== 'text' &&
    record.type !== 'thinking'
  ) return true
  return ['text', 'thinking'].some((key) => (
    typeof record[key] === 'string' && record[key].length > 0
  ))
}

async function primeNonStreamingResponse(response: Response): Promise<Response> {
  const text = await response.text()
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error('Upstream returned invalid JSON without model output')
  }

  if (payload.type === 'error') {
    const detail = payload.error && typeof payload.error === 'object'
      ? payload.error as Record<string, unknown>
      : undefined
    throw new Error(typeof detail?.message === 'string' ? detail.message : 'Upstream returned an error')
  }

  const content = payload.content
  const meaningful = typeof content === 'string'
    ? content.length > 0
    : Array.isArray(content) && content.some(hasMeaningfulAnthropicBlock)
  if (!meaningful) throw new Error('Upstream returned no model output')

  return new Response(text, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

function hasMeaningfulAnthropicEvent(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return false
  const payload = trimmed.slice(5).trim()
  if (!payload || payload === '[DONE]') return false

  let event: Record<string, unknown>
  try {
    event = JSON.parse(payload) as Record<string, unknown>
  } catch {
    return false
  }
  if (event.type === 'error') {
    const detail = event.error && typeof event.error === 'object'
      ? event.error as Record<string, unknown>
      : undefined
    throw new Error(typeof detail?.message === 'string' ? detail.message : 'Upstream stream returned an error')
  }

  if (event.type === 'content_block_start') {
    return hasMeaningfulAnthropicBlock(event.content_block)
  }
  if (event.type === 'content_block_delta') {
    const delta = event.delta && typeof event.delta === 'object'
      ? event.delta as Record<string, unknown>
      : undefined
    return Object.entries(delta ?? {}).some(([key, value]) => (
      key !== 'type' && typeof value === 'string' && value.length > 0
    ))
  }
  if (event.type === 'message_start') {
    const message = event.message && typeof event.message === 'object'
      ? event.message as Record<string, unknown>
      : undefined
    return Array.isArray(message?.content) && message.content.length > 0
  }
  return false
}

async function primeAnthropicStream(
  stream: ReadableStream<Uint8Array>,
): Promise<ReadableStream<Uint8Array>> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const bufferedChunks: Uint8Array[] = []
  let bufferedText = ''
  let bufferedBytes = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('Upstream stream produced no model output within 30 seconds')),
        30_000,
      )
    })

    while (true) {
      const next = await Promise.race([reader.read(), timeout])
      if (next.done || !next.value) {
        throw new Error('Upstream stream ended before producing model output')
      }

      bufferedChunks.push(next.value)
      bufferedBytes += next.value.byteLength
      if (bufferedBytes > 1_048_576) {
        throw new Error('Upstream stream produced too much metadata without model output')
      }

      bufferedText += decoder.decode(next.value, { stream: true })
      const lines = bufferedText.split(/\r?\n/)
      bufferedText = lines.pop() ?? ''
      if (lines.some(hasMeaningfulAnthropicEvent)) break
    }

    let chunkIndex = 0
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (chunkIndex < bufferedChunks.length) {
          controller.enqueue(bufferedChunks[chunkIndex++]!)
          return
        }
        try {
          const next = await reader.read()
          if (next.done) controller.close()
          else controller.enqueue(next.value)
        } catch (error) {
          controller.error(error)
        }
      },
      cancel(reason) {
        return reader.cancel(reason)
      },
    })
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function primeReadableStream(
  stream: ReadableStream<Uint8Array>,
): Promise<ReadableStream<Uint8Array>> {
  const reader = stream.getReader()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const first = await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Upstream stream produced no data within 30 seconds')), 30_000)
      }),
    ])
    if (first.done || !first.value) {
      await reader.cancel().catch(() => {})
      throw new Error('Upstream stream ended before producing data')
    }

    let firstPending = true
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (firstPending) {
          firstPending = false
          controller.enqueue(first.value)
          return
        }
        try {
          const next = await reader.read()
          if (next.done) controller.close()
          else controller.enqueue(next.value)
        } catch (error) {
          controller.error(error)
        }
      },
      cancel(reason) {
        return reader.cancel(reason)
      },
    })
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function handleOpenaiChat(
  body: AnthropicRequest,
  baseUrl: string,
  apiKey: string,
  isStream: boolean,
  requestSignal?: AbortSignal,
  extraHeaders?: Record<string, string>,
  oauthProviderId?: string,
  runtimeAuth?: ProviderRuntimeAuth,
  localModelPerformance = false,
  ollamaKeepAlive?: string,
): Promise<Response> {
  const isKimi = isKimiBaseUrl(baseUrl)
  const transformed = anthropicToOpenaiChat(body, {
    kimiThinking: isKimi,
    preserveReasoningContent: isKimi,
  }) as OpenAIChatRequest & { keep_alive?: string }
  // Ollama unloads models ~5min after the last request; keep_alive pins the
  // warmed model. Ollama tolerates the unknown field on /v1/chat/completions.
  if (ollamaKeepAlive) transformed.keep_alive = ollamaKeepAlive
  const native = oauthProviderId && runtimeAuth
    ? await executeNativeOAuthChat({
        providerId: oauthProviderId,
        request: transformed,
        auth: runtimeAuth,
        stream: isStream,
        signal: requestSignal,
      })
    : null
  const forceUpstreamStream = (
    oauthProviderId === 'codebuddy-cn' ||
    oauthProviderId === 'cline' ||
    native?.upstreamIsStream === true
  )
  if (forceUpstreamStream) transformed.stream = true
  const url = buildOpenAICompatibleUrl(baseUrl, 'chat/completions')

  const upstream = native?.response ?? await fetchUpstream(url, {
      method: 'POST',
      headers: buildOpenAICompatibleHeaders(baseUrl, apiKey, extraHeaders),
      body: JSON.stringify(transformed),
    }, isStream || forceUpstreamStream, requestSignal, localModelPerformance)

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '')
    return Response.json(
      {
        type: 'error',
        error: {
          type: 'api_error',
          message: `Upstream returned HTTP ${upstream.status}: ${errText.slice(0, 500)}`,
        },
      },
      {
        status: upstream.status,
        // A local 5xx (e.g. ollama OOM) is not transient — replaying the
        // full prompt against the same failing server only amplifies it.
        headers: localModelPerformance && upstream.status >= 500
          ? NO_RETRY_HEADERS
          : undefined,
      },
    )
  }

  if (isStream) {
    if (!upstream.body) {
      return Response.json(
        { type: 'error', error: { type: 'api_error', message: 'Upstream returned no body for stream' } },
        {
          status: 502,
          headers: localModelPerformance ? NO_RETRY_HEADERS : undefined,
        },
      )
    }
    const upstreamStream = localModelPerformance
      ? upstream.body
      : await primeReadableStream(upstream.body)
    const anthropicStream = openaiChatStreamToAnthropic(upstreamStream, body.model, localModelPerformance)
    return new Response(anthropicStream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  }

  if (forceUpstreamStream) {
    const responseBody = await readOpenAIChatStreamCompletion(upstream, body.model)
    return Response.json(openaiChatToAnthropic(responseBody, body.model))
  }

  // Non-streaming
  const responseBody = await upstream.json()
  const anthropicResponse = openaiChatToAnthropic(responseBody, body.model)
  return Response.json(anthropicResponse)
}

async function readOpenAIChatStreamCompletion(
  response: Response,
  fallbackModel: string,
): Promise<OpenAIChatResponse> {
  if (!response.body) throw new Error('Upstream returned no body for stream')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let id = `chatcmpl_${Date.now()}`
  let created = Math.floor(Date.now() / 1000)
  let model = fallbackModel
  let content = ''
  let reasoningContent = ''
  let finishReason: string | null = null
  let usage: OpenAIChatResponse['usage']
  const toolCalls = new Map<number, OpenAIToolCall>()

  const consumeLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const raw = trimmed.slice(5).trim()
    if (!raw || raw === '[DONE]') return

    let chunk: Record<string, unknown>
    try {
      chunk = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return
    }
    if (chunk.error && typeof chunk.error === 'object') {
      const detail = chunk.error as Record<string, unknown>
      throw new Error(typeof detail.message === 'string' ? detail.message : 'Upstream stream failed')
    }
    if (typeof chunk.id === 'string' && chunk.id) id = chunk.id
    if (typeof chunk.created === 'number') created = chunk.created
    if (typeof chunk.model === 'string' && chunk.model) model = chunk.model
    if (chunk.usage && typeof chunk.usage === 'object') {
      usage = chunk.usage as OpenAIChatResponse['usage']
    }

    const choices = Array.isArray(chunk.choices) ? chunk.choices : []
    const choice = choices[0]
    if (!choice || typeof choice !== 'object') return
    const choiceRecord = choice as Record<string, unknown>
    if (typeof choiceRecord.finish_reason === 'string') {
      finishReason = choiceRecord.finish_reason
    }
    const delta = choiceRecord.delta && typeof choiceRecord.delta === 'object'
      ? choiceRecord.delta as Record<string, unknown>
      : {}
    if (typeof delta.content === 'string') content += delta.content
    if (typeof delta.reasoning_content === 'string') reasoningContent += delta.reasoning_content
    if (typeof delta.reasoning === 'string') reasoningContent += delta.reasoning

    if (!Array.isArray(delta.tool_calls)) return
    for (const rawToolCall of delta.tool_calls) {
      if (!rawToolCall || typeof rawToolCall !== 'object') continue
      const fragment = rawToolCall as Record<string, unknown>
      const index = typeof fragment.index === 'number' ? fragment.index : toolCalls.size
      const previous = toolCalls.get(index) ?? {
        id: '',
        type: 'function',
        function: { name: '', arguments: '' },
      }
      const functionFragment = fragment.function &&
        typeof fragment.function === 'object' &&
        !Array.isArray(fragment.function)
        ? fragment.function as Record<string, unknown>
        : {}
      toolCalls.set(index, {
        id: typeof fragment.id === 'string' && fragment.id ? fragment.id : previous.id,
        type: 'function',
        function: {
          name: previous.function.name +
            (typeof functionFragment.name === 'string' ? functionFragment.name : ''),
          arguments: previous.function.arguments +
            (typeof functionFragment.arguments === 'string' ? functionFragment.arguments : ''),
        },
      })
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) consumeLine(line)
  }
  buffer += decoder.decode()
  if (buffer.trim()) consumeLine(buffer)

  return {
    id,
    object: 'chat.completion',
    created,
    model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content,
        ...(reasoningContent && { reasoning_content: reasoningContent }),
        ...(toolCalls.size > 0 && {
          tool_calls: [...toolCalls.entries()]
            .sort(([left], [right]) => left - right)
            .map(([, toolCall]) => toolCall),
        }),
      },
      finish_reason: finishReason ?? (toolCalls.size > 0 ? 'tool_calls' : 'stop'),
    }],
    ...(usage && { usage }),
  }
}

async function handleOpenaiResponses(
  body: AnthropicRequest,
  baseUrl: string,
  apiKey: string,
  isStream: boolean,
  requestSignal?: AbortSignal,
  extraHeaders?: Record<string, string>,
  oauthProviderId?: string,
  localModelPerformance = false,
): Promise<Response> {
  const baseRequest = anthropicToOpenaiResponses(body)
  const isCodex = oauthProviderId === 'codex'
  const isGrokBuild = oauthProviderId === 'grok-cli'
  const transformed = isCodex
    ? prepareCodexResponsesRequest(baseRequest)
    : isGrokBuild ? prepareGrokBuildResponsesRequest(baseRequest) : baseRequest
  const url = buildOpenAICompatibleUrl(baseUrl, 'responses')
  const upstreamIsStream = isCodex ? true : isStream
  const requestHeaders = {
    ...extraHeaders,
    ...(isGrokBuild && { 'X-Grok-Model-Override': body.model }),
  }

  const upstream = await fetchUpstream(url, {
    method: 'POST',
    headers: buildOpenAICompatibleHeaders(baseUrl, apiKey, requestHeaders),
    body: JSON.stringify(transformed),
  }, upstreamIsStream, requestSignal, localModelPerformance)

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '')
    return Response.json(
      {
        type: 'error',
        error: {
          type: 'api_error',
          message: `Upstream returned HTTP ${upstream.status}: ${errText.slice(0, 500)}`,
        },
      },
      { status: upstream.status },
    )
  }

  if (isStream) {
    if (!upstream.body) {
      return Response.json(
        { type: 'error', error: { type: 'api_error', message: 'Upstream returned no body for stream' } },
        {
          status: 502,
          headers: localModelPerformance ? NO_RETRY_HEADERS : undefined,
        },
      )
    }
    const upstreamStream = localModelPerformance
      ? upstream.body
      : await primeReadableStream(upstream.body)
    const anthropicStream = openaiResponsesStreamToAnthropic(upstreamStream, body.model)
    return new Response(anthropicStream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  }

  if (isCodex) {
    const responseBody = await readCodexResponsesCompletion(upstream)
    return Response.json(openaiResponsesToAnthropic(responseBody, body.model))
  }

  // Non-streaming
  const responseBody = await upstream.json()
  const anthropicResponse = openaiResponsesToAnthropic(responseBody, body.model)
  return Response.json(anthropicResponse)
}
