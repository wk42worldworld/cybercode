import type { PluginScope } from '../../utils/plugins/schemas.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import { PluginService } from '../services/pluginService.js'
import {
  installPluginMarketplaceItem,
  listPluginMarketplace,
  PluginMarketplaceError,
} from '../../plugins/pluginMarketplace.js'

const pluginService = new PluginService()

export async function handlePluginsApi(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const method = req.method
    const sub = segments[2]
    const cwd = url.searchParams.get('cwd') || undefined

    if (method === 'GET' && !sub) {
      return Response.json(await pluginService.listPlugins(cwd))
    }

    if (method === 'GET' && sub === 'detail') {
      const pluginId = url.searchParams.get('id')
      if (!pluginId) {
        throw ApiError.badRequest('Missing required "id" query parameter')
      }
      return Response.json({
        detail: await pluginService.getPluginDetail(pluginId, cwd),
      })
    }

    if (method === 'GET' && sub === 'marketplace') {
      return Response.json({
        catalog: await listPluginMarketplace({
          refresh: url.searchParams.get('refresh') === 'true',
          signal: req.signal,
        }),
      })
    }

    if (
      method === 'POST' &&
      sub === 'marketplace' &&
      segments[3] === 'install'
    ) {
      const body = await parseJsonBody(req)
      const itemId = asString(body.id)
      if (!itemId) {
        throw ApiError.badRequest('Missing or invalid "id" in request body')
      }
      return Response.json({
        ok: true,
        ...(await installPluginMarketplaceItem({ itemId })),
      })
    }

    if (method === 'POST' && sub === 'reload') {
      return Response.json(await pluginService.reloadPlugins(cwd))
    }

    if (method === 'POST' && sub) {
      const body = await parseJsonBody(req)
      const pluginId = asString(body.id)
      if (!pluginId) {
        throw ApiError.badRequest('Missing or invalid "id" in request body')
      }

      const scope = coerceScope(body.scope)

      switch (sub) {
        case 'enable':
          return Response.json(await pluginService.enablePlugin(pluginId, scope))
        case 'disable':
          return Response.json(await pluginService.disablePlugin(pluginId, scope))
        case 'update':
          return Response.json(
            await pluginService.updatePlugin(pluginId, scope as PluginScope | undefined),
          )
        case 'uninstall':
          return Response.json(
            await pluginService.uninstallPlugin(
              pluginId,
              scope,
              body.keepData === true,
            ),
          )
        default:
          throw ApiError.notFound(`Unknown plugins endpoint: ${sub}`)
      }
    }

    throw new ApiError(
      405,
      `Method ${method} not allowed on /api/plugins${sub ? `/${sub}` : ''}`,
      'METHOD_NOT_ALLOWED',
    )
  } catch (error) {
    if (error instanceof PluginMarketplaceError) {
      const status = error.code === 'NOT_FOUND'
        ? 404
        : error.code === 'UNAVAILABLE'
          ? 503
          : error.code === 'CANCELLED'
            ? 499
            : 400
      return errorResponse(new ApiError(status, error.message, error.code))
    }
    return errorResponse(error)
  }
}

async function parseJsonBody(req: Request): Promise<Record<string, unknown>> {
  let parsed: unknown
  try {
    parsed = await req.json()
  } catch {
    throw ApiError.badRequest('Invalid JSON body')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw ApiError.badRequest('JSON body must be an object')
  }
  return parsed as Record<string, unknown>
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function coerceScope(value: unknown):
  | 'user'
  | 'project'
  | 'local'
  | 'managed'
  | undefined {
  if (value == null) return undefined
  if (
    value === 'user' ||
    value === 'project' ||
    value === 'local' ||
    value === 'managed'
  ) {
    return value
  }
  throw ApiError.badRequest(
    'Invalid "scope". Expected one of: user, project, local, managed',
  )
}
