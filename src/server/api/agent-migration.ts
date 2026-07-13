import {
  AgentMigrationError,
  agentMigrationService,
  type AgentMigrationRequest,
  type ExternalAgentId,
} from '../services/agentMigrationService.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import { invalidateRecentProjectsCache } from './sessions.js'

const AGENT_IDS = new Set<ExternalAgentId>([
  'cybercode',
  'openclaw',
  'claude-code',
  'codex',
  'cursor',
  'hermes-agent',
  'deepseek-tui',
])
const MIGRATION_ID_PATTERN = /^[a-f0-9]{24}$/

export async function handleAgentMigrationApi(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const resource = segments[2]

    if (!resource && req.method === 'GET') {
      const targetAgentId = parseOptionalAgentId(url.searchParams.get('targetAgentId')) ?? 'cybercode'
      return Response.json(await agentMigrationService.scan(targetAgentId))
    }

    if (resource === 'items' && segments[3] && req.method === 'GET') {
      const agentId = parseAgentId(url.searchParams.get('agentId'))
      const targetAgentId = parseOptionalAgentId(url.searchParams.get('targetAgentId')) ?? 'cybercode'
      return Response.json(await agentMigrationService.preview(agentId, segments[3], targetAgentId))
    }

    if (resource === 'migrate' && req.method === 'POST') {
      const body = await parseBody(req)
      const request: AgentMigrationRequest = {
        agentId: parseAgentId(body.agentId),
        targetAgentId: parseOptionalAgentId(body.targetAgentId) ?? 'cybercode',
        itemIds: parseStringArray(body.itemIds, 'itemIds'),
        projectIds: parseStringArray(body.projectIds, 'projectIds'),
        allRecommended: body.allRecommended === true,
      }
      const result = await agentMigrationService.migrate(request)
      if (result.registeredProjects.length > 0) invalidateRecentProjectsCache()
      return Response.json(result)
    }

    throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
  } catch (error) {
    if (error instanceof AgentMigrationError) {
      return errorResponse(new ApiError(error.status, error.message, error.code))
    }
    return errorResponse(error)
  }
}

async function parseBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('Invalid body')
    }
    return body as Record<string, unknown>
  } catch {
    throw ApiError.badRequest('Invalid JSON body')
  }
}

function parseAgentId(value: unknown): ExternalAgentId {
  if (typeof value === 'string' && AGENT_IDS.has(value as ExternalAgentId)) {
    return value as ExternalAgentId
  }
  throw ApiError.badRequest('Unknown agentId')
}

function parseOptionalAgentId(value: unknown): ExternalAgentId | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return parseAgentId(value)
}

function parseStringArray(value: unknown, name: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(entry =>
    typeof entry !== 'string' || !MIGRATION_ID_PATTERN.test(entry))) {
    throw ApiError.badRequest(`${name} must contain valid migration IDs`)
  }
  if (value.length > 500) {
    throw ApiError.badRequest(`${name} contains too many entries`)
  }
  return [...new Set(value as string[])]
}
