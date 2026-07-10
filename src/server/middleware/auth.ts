/**
 * Authentication middleware
 *
 * Desktop sidecars use an ephemeral SERVER_AUTH_TOKEN. Remote/legacy launches
 * can still fall back to ANTHROPIC_API_KEY.
 */

export function validateAuth(req: Request): { valid: boolean; error?: string } {
  const authHeader = req.headers.get('Authorization')
  const bearer = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]
  const token =
    bearer ||
    req.headers.get('x-api-key') ||
    new URL(req.url).searchParams.get('token')
  if (!token) {
    return { valid: false, error: 'Missing server authorization token' }
  }

  const expectedToken =
    process.env.SERVER_AUTH_TOKEN ||
    process.env.ANTHROPIC_API_KEY
  if (!expectedToken) {
    return { valid: false, error: 'Server authorization token is not configured' }
  }

  if (token !== expectedToken) {
    return { valid: false, error: 'Invalid server authorization token' }
  }

  return { valid: true }
}

/**
 * Helper to check auth and return 401 if invalid
 */
export function requireAuth(req: Request): Response | null {
  const { valid, error } = validateAuth(req)
  if (!valid) {
    return Response.json({ error: 'Unauthorized', message: error }, { status: 401 })
  }
  return null
}
