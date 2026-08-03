import { z } from 'zod'
import { errorResponse, ApiError } from '../middleware/errorHandler.js'
import { p2pService } from '../p2p/p2pService.js'

const ShareSchema = z.object({
  allowedTargets: z.array(z.string().trim().min(1)).max(500).optional(),
  nodeName: z.string().trim().max(80).optional(),
})

const JoinSchema = z.object({
  code: z.string().trim(),
  deviceName: z.string().trim().max(80).optional(),
})

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    throw ApiError.badRequest('Invalid JSON body')
  }
}

export async function handleP2PApi(
  req: Request,
  _url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const action = segments[2]
    const id = segments[3]
    if (!action && req.method === 'GET') return Response.json(await p2pService.status())
    if (action === 'share' && req.method === 'POST') {
      const input = ShareSchema.parse(await readJson(req))
      return Response.json(await p2pService.startSharing(input))
    }
    if (action === 'share' && req.method === 'DELETE') {
      await p2pService.stopSharing()
      return Response.json(await p2pService.status())
    }
    if (action === 'join' && req.method === 'POST') {
      const input = JoinSchema.parse(await readJson(req))
      return Response.json(await p2pService.joinRemote(input))
    }
    if (action === 'peers' && id && req.method === 'DELETE') {
      return Response.json(await p2pService.revokePeer(id))
    }
    throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(ApiError.badRequest(error.issues.map((issue) => issue.message).join('; ')))
    }
    return errorResponse(error)
  }
}
