/**
 * Providers REST API
 *
 * GET    /api/providers              — list all saved providers + activeId
 * GET    /api/providers/presets       — list available presets
 * GET    /api/providers/auth-status   — check whether any usable auth exists
 * GET    /api/providers/settings      — read cybercode managed settings.json
 * POST   /api/providers              — add a provider
 * PUT    /api/providers/settings      — update cybercode managed settings.json
 * PUT    /api/providers/:id          — update a provider
 * DELETE /api/providers/:id          — delete a provider
 * POST   /api/providers/:id/activate — activate a saved provider
 * POST   /api/providers/official     — activate official (clear env)
 * POST   /api/providers/:id/test     — test a saved provider
 * POST   /api/providers/test         — test unsaved config
 */

import { z } from 'zod'
import { ProviderService } from '../services/providerService.js'
import { PROVIDER_PRESETS } from '../config/providerPresets.js'
import {
  CreateProviderSchema,
  UpdateProviderSchema,
  TestProviderSchema,
  ApiFormatSchema,
} from '../types/provider.js'
import type { SavedProvider } from '../types/provider.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import { discoverProviderModels } from '../services/providerModelDiscovery.js'

const providerService = new ProviderService()
const MASKED_API_KEY = '••••••••'
const DiscoverProviderModelsSchema = z.object({
  providerId: z.string().optional(),
  presetId: z.string().optional(),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  apiFormat: ApiFormatSchema.optional(),
  force: z.boolean().optional(),
})

export async function handleProvidersApi(
  req: Request,
  _url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const id = segments[2]
    const action = segments[3]

    // POST /api/providers/models/discover
    if (id === 'models' && action === 'discover' && req.method === 'POST') {
      return await handleDiscoverModels(req)
    }

    // POST /api/providers/test
    if (id === 'test' && req.method === 'POST') {
      return await handleTestUnsaved(req)
    }

    // GET /api/providers/presets
    if (id === 'presets' && req.method === 'GET') {
      return Response.json({ presets: PROVIDER_PRESETS })
    }

    // GET /api/providers/auth-status
    if (id === 'auth-status' && req.method === 'GET') {
      const status = await providerService.checkAuthStatus()
      return Response.json(status)
    }

    // /api/providers/settings
    if (id === 'settings') {
      if (req.method === 'GET') {
        return Response.json(maskManagedSettings(await providerService.getManagedSettings()))
      }
      if (req.method === 'PUT') {
        const body = await parseJsonBody(req)
        await providerService.updateManagedSettings(body)
        return Response.json({ ok: true })
      }
      throw methodNotAllowed(req.method)
    }

    // POST /api/providers/official
    if (id === 'official' && req.method === 'POST') {
      await providerService.activateOfficial()
      return Response.json({ ok: true })
    }

    // /api/providers (no ID)
    if (!id) {
      if (req.method === 'GET') {
        const { providers, activeId } = await providerService.listProviders()
        return Response.json({ providers: providers.map(toPublicProvider), activeId })
      }
      if (req.method === 'POST') {
        return await handleCreate(req)
      }
      throw methodNotAllowed(req.method)
    }

    // /api/providers/:id/activate
    if (action === 'activate') {
      if (req.method !== 'POST') throw methodNotAllowed(req.method)
      await providerService.activateProvider(id)
      return Response.json({ ok: true })
    }

    // /api/providers/:id/test
    if (action === 'test') {
      if (req.method !== 'POST') throw methodNotAllowed(req.method)
      let overrides: Parameters<ProviderService['testProvider']>[1]
      try {
        const body = await req.json()
        if (body && typeof body === 'object') overrides = body as typeof overrides
      } catch { /* no body is fine — uses saved values */ }
      const result = await providerService.testProvider(id, overrides)
      return Response.json({ result })
    }

    // /api/providers/:id
    if (req.method === 'GET') {
      const provider = await providerService.getProvider(id)
      return Response.json({ provider: toPublicProvider(provider) })
    }
    if (req.method === 'PUT') {
      return await handleUpdate(req, id)
    }
    if (req.method === 'DELETE') {
      await providerService.deleteProvider(id)
      return Response.json({ ok: true })
    }

    throw methodNotAllowed(req.method)
  } catch (error) {
    return errorResponse(error)
  }
}

async function handleCreate(req: Request): Promise<Response> {
  const body = await parseJsonBody(req)
  try {
    const input = CreateProviderSchema.parse(body)
    const provider = await providerService.addProvider(input)
    return Response.json({ provider: toPublicProvider(provider) }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) throw ApiError.badRequest(err.issues.map((i) => i.message).join('; '))
    throw err
  }
}

async function handleUpdate(req: Request, id: string): Promise<Response> {
  const body = await parseJsonBody(req)
  try {
    const input = UpdateProviderSchema.parse(body)
    const provider = await providerService.updateProvider(id, input)
    return Response.json({ provider: toPublicProvider(provider) })
  } catch (err) {
    if (err instanceof z.ZodError) throw ApiError.badRequest(err.issues.map((i) => i.message).join('; '))
    throw err
  }
}

async function handleTestUnsaved(req: Request): Promise<Response> {
  const body = await parseJsonBody(req)
  try {
    const input = TestProviderSchema.parse(body)
    const result = await providerService.testProviderConfig(input)
    return Response.json({ result })
  } catch (err) {
    if (err instanceof z.ZodError) throw ApiError.badRequest(err.issues.map((i) => i.message).join('; '))
    throw err
  }
}

async function handleDiscoverModels(req: Request): Promise<Response> {
  const body = await parseJsonBody(req)
  try {
    const input = DiscoverProviderModelsSchema.parse(body)
    const saved = input.providerId
      ? await providerService.getProvider(input.providerId)
      : undefined
    const baseUrl = input.baseUrl?.trim() || saved?.baseUrl
    if (!baseUrl) throw ApiError.badRequest('A provider or baseUrl is required')
    const suppliedKey = input.apiKey?.trim()
    const apiKey = suppliedKey && suppliedKey !== MASKED_API_KEY && suppliedKey !== '***'
      ? suppliedKey
      : saved?.apiKey
    const result = await discoverProviderModels({
      baseUrl,
      apiKey,
      apiFormat: input.apiFormat ?? saved?.apiFormat ?? 'anthropic',
      presetId: input.presetId ?? saved?.presetId,
    }, { force: input.force })
    return Response.json({ result })
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw ApiError.badRequest(err.issues.map((issue) => issue.message).join('; '))
    }
    if (err instanceof ApiError) throw err
    throw ApiError.badRequest(err instanceof Error ? err.message : String(err))
  }
}

async function parseJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>
  } catch {
    throw ApiError.badRequest('Invalid JSON body')
  }
}

function methodNotAllowed(method: string): ApiError {
  return new ApiError(405, `Method ${method} not allowed`, 'METHOD_NOT_ALLOWED')
}

function toPublicProvider(provider: SavedProvider): SavedProvider {
  return {
    ...provider,
    apiKey: provider.apiKey ? MASKED_API_KEY : '',
  }
}

function maskManagedSettings(settings: Record<string, unknown>): Record<string, unknown> {
  const masked = { ...settings }
  if (!masked.env || typeof masked.env !== 'object' || Array.isArray(masked.env)) {
    return masked
  }

  const env = { ...(masked.env as Record<string, unknown>) }
  for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) {
    if (typeof env[key] === 'string' && env[key]) env[key] = MASKED_API_KEY
  }
  masked.env = env
  return masked
}
