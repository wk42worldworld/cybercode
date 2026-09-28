import { codeGraphService } from '../services/codeGraphService.js'
import { cavemanOptimizationService } from '../../services/cavemanOptimization.js'
import { liteOptimizationService } from '../../services/liteOptimization.js'
import { ponytailOptimizationService } from '../../services/ponytailOptimization.js'
import { rtkOptimizationService } from '../../services/rtkOptimization.js'
import {
  isSmartPruningLevel,
  smartPruningOptimizationService,
} from '../../services/smartPruningOptimization.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'

export async function handleTokenOptimizationApi(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  try {
    if (segments[2] === 'lite') {
      return handleLiteRequest(req, segments)
    }

    if (segments[2] === 'ponytail') {
      return handlePonytailRequest(req, segments)
    }

    if (segments[2] === 'rtk') {
      return await handleRtkRequest(req, segments)
    }

    if (segments[2] === 'caveman') {
      return handleCavemanRequest(req, segments)
    }

    if (segments[2] === 'pruning') {
      return await handleSmartPruningRequest(req, segments)
    }

    if (segments[2] !== 'codegraph') {
      throw ApiError.notFound(`Unknown token optimization endpoint: ${segments[2]}`)
    }

    const action = segments[3]
    if (action === 'global') {
      const globalAction = segments[4]
      if (globalAction === undefined && req.method === 'GET') {
        return Response.json(codeGraphService.getGlobalStatus())
      }
      if (globalAction === 'enable' && req.method === 'POST') {
        return Response.json(codeGraphService.enableGlobal())
      }
      if (globalAction === 'disable' && req.method === 'POST') {
        return Response.json(await codeGraphService.disableGlobal())
      }
      throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
    }

    if (action === undefined && req.method === 'GET') {
      return Response.json(codeGraphService.getStatus(requireProjectPath(url)))
    }

    if (action === 'graph' && req.method === 'GET') {
      const rawLimit = Number.parseInt(url.searchParams.get('limit') || '120', 10)
      return Response.json(
        codeGraphService.getVisualization(
          requireProjectPath(url),
          Number.isFinite(rawLimit) ? rawLimit : 120,
        ),
      )
    }

    if (action === 'enable' && req.method === 'POST') {
      return Response.json(await codeGraphService.enable(await readProjectPath(req)), {
        status: 202,
      })
    }

    if (action === 'disable' && req.method === 'POST') {
      return Response.json(await codeGraphService.disable(await readProjectPath(req)))
    }

    if (action === 'rebuild' && req.method === 'POST') {
      return Response.json(await codeGraphService.rebuild(await readProjectPath(req)), {
        status: 202,
      })
    }

    throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error)
    if (error instanceof Error) {
      return errorResponse(ApiError.badRequest(error.message))
    }
    return errorResponse(error)
  }
}

function handleLiteRequest(req: Request, segments: string[]) {
  const action = segments[3]
  if (action === undefined && req.method === 'GET') {
    return Response.json(liteOptimizationService.getStatus())
  }
  if (action === 'enable' && req.method === 'POST') {
    return Response.json(liteOptimizationService.setEnabled(true))
  }
  if (action === 'disable' && req.method === 'POST') {
    return Response.json(liteOptimizationService.setEnabled(false))
  }
  throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
}

function handleCavemanRequest(req: Request, segments: string[]) {
  const action = segments[3]
  if (action === undefined && req.method === 'GET') {
    return Response.json(cavemanOptimizationService.getStatus())
  }
  if (action === 'enable' && req.method === 'POST') {
    return Response.json(cavemanOptimizationService.setEnabled(true))
  }
  if (action === 'disable' && req.method === 'POST') {
    return Response.json(cavemanOptimizationService.setEnabled(false))
  }
  throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
}

function handlePonytailRequest(req: Request, segments: string[]) {
  const action = segments[3]
  if (action === undefined && req.method === 'GET') {
    return Response.json(ponytailOptimizationService.getStatus())
  }
  if (action === 'enable' && req.method === 'POST') {
    return Response.json(ponytailOptimizationService.setEnabled(true))
  }
  if (action === 'disable' && req.method === 'POST') {
    return Response.json(ponytailOptimizationService.setEnabled(false))
  }
  throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
}

async function handleRtkRequest(req: Request, segments: string[]) {
  const action = segments[3]
  if (action === undefined && req.method === 'GET') {
    return Response.json(await rtkOptimizationService.getStatus())
  }
  if (action === 'enable' && req.method === 'POST') {
    return Response.json(await rtkOptimizationService.setEnabled(true))
  }
  if (action === 'disable' && req.method === 'POST') {
    return Response.json(await rtkOptimizationService.setEnabled(false))
  }
  throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
}

async function handleSmartPruningRequest(req: Request, segments: string[]) {
  const action = segments[3]
  if (action === undefined && req.method === 'GET') {
    return Response.json(smartPruningOptimizationService.getStatus())
  }
  if (action === 'enable' && req.method === 'POST') {
    return Response.json(smartPruningOptimizationService.setEnabled(true))
  }
  if (action === 'disable' && req.method === 'POST') {
    return Response.json(smartPruningOptimizationService.setEnabled(false))
  }
  if (action === 'level' && req.method === 'POST') {
    const body = await readJsonObject(req)
    if (!isSmartPruningLevel(body.level)) {
      throw ApiError.badRequest('Invalid smart pruning level')
    }
    return Response.json(smartPruningOptimizationService.setLevel(body.level))
  }
  throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
}

function requireProjectPath(url: URL) {
  const projectPath = url.searchParams.get('projectPath')?.trim()
  if (!projectPath) throw ApiError.badRequest('Missing projectPath')
  return projectPath
}

async function readProjectPath(req: Request) {
  const body = await readJsonObject(req)
  const projectPath = body.projectPath
  if (typeof projectPath !== 'string' || !projectPath.trim()) {
    throw ApiError.badRequest('Missing projectPath')
  }
  return projectPath
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
