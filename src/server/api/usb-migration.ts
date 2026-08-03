import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import {
  UsbMigrationError,
  usbMigrationService,
  type StartUsbMigrationInput,
  type UsbMigrationPlatform,
} from '../services/usbMigrationService.js'

const JOB_ID_PATTERN = /^[a-f0-9]{24}$/
const PROJECT_ID_PATTERN = /^[a-f0-9]{20}$/
const PLATFORMS = new Set<UsbMigrationPlatform>([
  'macos-arm64',
  'macos-x64',
  'windows-x64',
  'linux-x64',
])

export async function handleUsbMigrationApi(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const resource = segments[2]

    if ((!resource || resource === 'scan') && req.method === 'GET') {
      return Response.json(
        await usbMigrationService.scan(
          url.searchParams.get('force') === 'true',
          req.signal,
        ),
      )
    }

    if (resource === 'start' && req.method === 'POST') {
      const body = await parseBody(req)
      const input: StartUsbMigrationInput = {
        destinationPath: parseDestinationPath(body.destinationPath),
        projectIds: parseProjectIds(body.projectIds),
        platforms: parsePlatforms(body.platforms),
        includeApplications: parseOptionalBoolean(
          body.includeApplications,
          'includeApplications',
        ),
        replaceExisting: parseOptionalBoolean(
          body.replaceExisting,
          'replaceExisting',
        ),
      }
      return Response.json(
        await usbMigrationService.start(input, req.signal),
        { status: 202 },
      )
    }

    if (resource === 'portable-paths' && !segments[3] && req.method === 'GET') {
      return Response.json(usbMigrationService.getPortablePathStatus())
    }

    if (resource === 'recovery' && req.method === 'GET') {
      return Response.json(usbMigrationService.getRecoveryStatus())
    }

    if (
      resource === 'portable-paths'
      && segments[3] === 'repair'
      && req.method === 'POST'
    ) {
      return Response.json(await usbMigrationService.repairPortableProjectPaths())
    }

    if (resource === 'jobs' && segments[3]) {
      const jobId = parseJobId(segments[3])
      if (!segments[4] && req.method === 'GET') {
        return Response.json(usbMigrationService.getJob(jobId))
      }
      if (segments[4] === 'cancel' && req.method === 'POST') {
        return Response.json(usbMigrationService.cancel(jobId))
      }
    }

    throw new ApiError(
      405,
      `Method ${req.method} not allowed`,
      'METHOD_NOT_ALLOWED',
    )
  } catch (error) {
    if (error instanceof UsbMigrationError) {
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

function parseDestinationPath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) {
    throw ApiError.badRequest('destinationPath must be a valid directory path')
  }
  return value.trim()
}

function parseProjectIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (
    !Array.isArray(value)
    || value.length > 500
    || value.some(id =>
      typeof id !== 'string' || !PROJECT_ID_PATTERN.test(id))
  ) {
    throw ApiError.badRequest('projectIds must contain valid project IDs')
  }
  return [...new Set(value as string[])]
}

function parsePlatforms(value: unknown): UsbMigrationPlatform[] | undefined {
  if (value === undefined) return undefined
  if (
    !Array.isArray(value)
    || value.length > PLATFORMS.size
    || value.some(platform =>
      typeof platform !== 'string'
      || !PLATFORMS.has(platform as UsbMigrationPlatform))
  ) {
    throw ApiError.badRequest('platforms must contain supported platform IDs')
  }
  return [...new Set(value as UsbMigrationPlatform[])]
}

function parseOptionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') {
    throw ApiError.badRequest(`${name} must be a boolean`)
  }
  return value
}

function parseJobId(value: string): string {
  if (!JOB_ID_PATTERN.test(value)) {
    throw ApiError.badRequest('Invalid migration job ID')
  }
  return value
}
