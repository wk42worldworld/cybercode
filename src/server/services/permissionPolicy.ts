function normalizeToolName(toolName: string): string {
  return toolName.replace(/[^a-z0-9]/gi, '').toLowerCase()
}

export function shouldAutoApproveBypassPermission(
  permissionMode: string | undefined,
  message: unknown,
): boolean {
  if (permissionMode !== 'bypassPermissions' || !message || typeof message !== 'object') {
    return false
  }

  const controlMessage = message as Record<string, unknown>
  if (controlMessage.type !== 'control_request' || typeof controlMessage.request_id !== 'string') {
    return false
  }

  const request = controlMessage.request
  if (!request || typeof request !== 'object') return false

  const permissionRequest = request as Record<string, unknown>
  if (permissionRequest.subtype !== 'can_use_tool') return false

  const toolName = typeof permissionRequest.tool_name === 'string'
    ? normalizeToolName(permissionRequest.tool_name)
    : ''

  // AskUserQuestion carries the user's answers in updatedInput, so it cannot
  // be resolved without displaying the question even in full-access mode.
  return !toolName.endsWith('askuserquestion')
}
