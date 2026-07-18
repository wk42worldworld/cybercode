import { getKnowledgeService } from '../../knowledge/service.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'

export async function handleKnowledgeApi(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const knowledgeService = getKnowledgeService()
    const resource = segments[2]

    if (resource === 'sources') {
      const sourceId = segments[3] ? decodeURIComponent(segments[3]) : undefined
      const action = segments[4]
      if (!sourceId && req.method === 'GET') {
        return Response.json(knowledgeService.listSources())
      }
      if (!sourceId && req.method === 'POST') {
        const body = await readJsonObject(req)
        if (!Array.isArray(body.paths) || !body.paths.every((path) => typeof path === 'string')) {
          throw ApiError.badRequest('paths must be an array of file or folder paths')
        }
        return Response.json(await knowledgeService.addSources(body.paths), { status: 202 })
      }
      if (sourceId && !action && req.method === 'DELETE') {
        if (!knowledgeService.removeSource(sourceId)) throw ApiError.notFound('Knowledge source not found')
        return Response.json({ removed: true })
      }
      if (sourceId && action === 'reindex' && req.method === 'POST') {
        return Response.json(await knowledgeService.reindexSource(sourceId), { status: 202 })
      }
      throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
    }

    if (resource === 'documents' && req.method === 'GET') {
      return Response.json(knowledgeService.listDocuments({
        sourceId: url.searchParams.get('sourceId') || undefined,
        limit: readLimit(url, 500),
      }))
    }

    if (resource === 'search' && req.method === 'GET') {
      return Response.json(knowledgeService.search(url.searchParams.get('q') || '', {
        sourceId: url.searchParams.get('sourceId') || undefined,
        limit: readLimit(url, 30),
      }))
    }

    if (resource === 'stats' && req.method === 'GET') {
      return Response.json(knowledgeService.getStats())
    }

    throw ApiError.notFound(`Unknown knowledge endpoint: ${resource}`)
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error)
    if (error instanceof Error) return errorResponse(ApiError.badRequest(error.message))
    return errorResponse(error)
  }
}

function readLimit(url: URL, fallback: number): number {
  const value = Number.parseInt(url.searchParams.get('limit') || String(fallback), 10)
  return Number.isFinite(value) ? value : fallback
}

async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw ApiError.badRequest('Invalid JSON body')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw ApiError.badRequest('Invalid JSON body')
  }
  return body as Record<string, unknown>
}
