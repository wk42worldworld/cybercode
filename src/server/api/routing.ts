import { z } from 'zod'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import { routingService } from '../routing/routingService.js'

async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    throw ApiError.badRequest('Invalid JSON body')
  }
}

export async function handleRoutingApi(
  req: Request,
  _url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const action = segments[2]

    if (!action && req.method === 'GET') {
      return Response.json(await routingService.getDashboard())
    }

    if (action === 'config') {
      if (req.method === 'GET') {
        return Response.json({ config: await routingService.getConfig() })
      }
      if (req.method === 'PUT') {
        const body = await readJsonBody(req)
        try {
          return Response.json({ config: await routingService.updateConfig(body) })
        } catch (error) {
          if (error instanceof z.ZodError) {
            throw ApiError.badRequest(error.issues.map((issue) => issue.message).join('; '))
          }
          throw error
        }
      }
    }

    if (action === 'preview' && req.method === 'POST') {
      const body = z.object({
        profileId: z.string().trim().min(1),
        graph: z.unknown().optional(),
        sample: z.unknown().optional(),
      }).parse(await readJsonBody(req))
      return Response.json({
        trace: await routingService.previewGraph(body.profileId, body.graph, body.sample),
      })
    }

    if (action === 'publish' && req.method === 'POST') {
      const body = z.object({
        profileId: z.string().trim().min(1),
        graph: z.unknown().optional(),
        name: z.unknown().optional(),
      }).parse(await readJsonBody(req))
      return Response.json(await routingService.publishDraftGraph(
        body.profileId,
        body.graph,
        body.name,
      ))
    }

    if (action === 'rollback' && req.method === 'POST') {
      const body = z.object({
        profileId: z.string().trim().min(1),
      }).parse(await readJsonBody(req))
      return Response.json(await routingService.rollbackGraph(body.profileId))
    }

    if (action === 'reset-health' && req.method === 'POST') {
      routingService.resetHealth()
      return Response.json({ ok: true })
    }

    throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(ApiError.badRequest(
        error.issues.map((issue) => issue.message).join('; '),
      ))
    }
    return errorResponse(error)
  }
}
