import { describe, expect, test } from 'bun:test'

import darwinRequirements from '../../../runtime/requirements.txt' with { type: 'text' }
import win32Requirements from '../../../runtime/requirements-win.txt' with { type: 'text' }

function findRequirement(requirements: string, packageName: string): string | undefined {
  return requirements
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line.startsWith(`${packageName}`))
}

describe('computer use requirements', () => {
  test('pins mss to the last Python 3.8-compatible major version', () => {
    expect(findRequirement(darwinRequirements, 'mss')).toBe('mss>=9.0.2,<10')
    expect(findRequirement(win32Requirements, 'mss')).toBe('mss>=9.0.2,<10')
  })
})
