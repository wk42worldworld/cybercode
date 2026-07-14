import { describe, expect, it } from 'bun:test'
import { shouldAutoApproveBypassPermission } from '../services/permissionPolicy.js'

function permissionRequest(toolName: string) {
  return {
    type: 'control_request',
    request_id: 'request-1',
    request: {
      subtype: 'can_use_tool',
      tool_name: toolName,
      input: {},
    },
  }
}

describe('bypass permission policy', () => {
  it('auto-approves ExitPlanMode without forwarding a desktop prompt', () => {
    expect(
      shouldAutoApproveBypassPermission(
        'bypassPermissions',
        permissionRequest('ExitPlanMode'),
      ),
    ).toBe(true)
  })

  it('auto-approves ordinary tool requests in bypass mode', () => {
    expect(
      shouldAutoApproveBypassPermission(
        'bypassPermissions',
        permissionRequest('Bash'),
      ),
    ).toBe(true)
  })

  it('keeps AskUserQuestion interactive because its answer comes from the user', () => {
    expect(
      shouldAutoApproveBypassPermission(
        'bypassPermissions',
        permissionRequest('AskUserQuestion'),
      ),
    ).toBe(false)
  })

  it('does not auto-approve requests in other permission modes', () => {
    expect(
      shouldAutoApproveBypassPermission(
        'default',
        permissionRequest('ExitPlanMode'),
      ),
    ).toBe(false)
  })
})
