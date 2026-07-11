/**
 * Prompt memory REST API
 *
 * GET  /api/prompt-memory
 * GET  /api/prompt-memory/logs
 * GET  /api/prompt-memory/:target
 * PUT  /api/prompt-memory/:target
 * POST /api/prompt-memory/:target/entries
 */

import { readPromptMemoryAutoReviewLogs } from '../../promptMemory/autoReview.js'
import { buildPromptMemoryInsights } from '../../promptMemory/insights.js'
import {
  PromptMemoryError,
  addPromptMemoryEntry,
  getPromptMemoryStatus,
  parsePromptMemoryTarget,
  readPromptMemoryFile,
  removePromptMemoryEntry,
  replacePromptMemoryEntry,
  writePromptMemoryFile,
  type PromptMemoryAction,
} from '../../promptMemory/store.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'

export async function handlePromptMemoryApi(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  try {
    if (segments[2] === 'logs') {
      if (req.method !== 'GET') throw methodNotAllowed(req.method)
      const limit = Number.parseInt(url.searchParams.get('limit') ?? '50', 10)
      return Response.json(
        await readPromptMemoryAutoReviewLogs(Number.isFinite(limit) ? limit : 50),
      )
    }

    if (segments[2] === 'insights') {
      if (req.method !== 'GET') throw methodNotAllowed(req.method)
      const [status, logs] = await Promise.all([
        getPromptMemoryStatus(),
        readPromptMemoryAutoReviewLogs(200),
      ])
      return Response.json(buildPromptMemoryInsights({
        files: {
          user: status.files.user,
          brief: status.files.brief,
        },
        logs,
      }))
    }

    const target = parsePromptMemoryTarget(segments[2])
    const sub = segments[3]

    if (!target) {
      if (segments[2] === undefined && req.method === 'GET') {
        return Response.json(await getPromptMemoryStatus())
      }
      throw ApiError.notFound(`Unknown prompt memory target: ${segments[2]}`)
    }

    if (sub === undefined) {
      if (req.method === 'GET') {
        return Response.json(await readPromptMemoryFile(target))
      }
      if (req.method === 'PUT') {
        const body = await parseJsonBody(req)
        if (typeof body.content !== 'string') {
          throw ApiError.badRequest('Missing or invalid "content"')
        }
        return Response.json(await writePromptMemoryFile(target, body.content))
      }
      throw methodNotAllowed(req.method)
    }

    if (sub === 'entries') {
      if (req.method !== 'POST') throw methodNotAllowed(req.method)
      const body = await parseJsonBody(req)
      const action = parseAction(body.action)
      switch (action) {
        case 'add': {
          if (typeof body.content !== 'string') {
            throw ApiError.badRequest('Missing or invalid "content"')
          }
          return Response.json(await addPromptMemoryEntry(target, body.content))
        }
        case 'replace': {
          if (
            typeof body.oldText !== 'string' ||
            typeof body.content !== 'string'
          ) {
            throw ApiError.badRequest(
              'Missing or invalid "oldText" or "content"',
            )
          }
          return Response.json(
            await replacePromptMemoryEntry(target, body.oldText, body.content),
          )
        }
        case 'remove': {
          if (typeof body.oldText !== 'string') {
            throw ApiError.badRequest('Missing or invalid "oldText"')
          }
          return Response.json(await removePromptMemoryEntry(target, body.oldText))
        }
      }
    }

    throw ApiError.notFound(`Unknown prompt memory endpoint: ${sub}`)
  } catch (error) {
    if (error instanceof PromptMemoryError) {
      return errorResponse(new ApiError(error.status, error.message, error.code))
    }
    return errorResponse(error)
  }
}

async function parseJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>
  } catch {
    throw ApiError.badRequest('Invalid JSON body')
  }
}

function parseAction(value: unknown): PromptMemoryAction {
  if (value === 'add' || value === 'replace' || value === 'remove') return value
  throw ApiError.badRequest('Invalid "action". Expected add, replace, or remove.')
}

function methodNotAllowed(method: string): ApiError {
  return new ApiError(405, `Method ${method} not allowed`, 'METHOD_NOT_ALLOWED')
}
