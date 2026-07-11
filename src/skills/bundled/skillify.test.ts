import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { clearBundledSkills, getBundledSkills } from '../bundledSkills.js'
import { registerSkillifySkill } from './skillify.js'

describe('bundled /skillify', () => {
  let originalUserType: string | undefined

  beforeEach(() => {
    originalUserType = process.env.USER_TYPE
    process.env.USER_TYPE = 'external'
    clearBundledSkills()
  })

  afterEach(() => {
    clearBundledSkills()
    if (originalUserType === undefined) delete process.env.USER_TYPE
    else process.env.USER_TYPE = originalUserType
  })

  test('is available to external CyberCode users', () => {
    registerSkillifySkill()

    expect(getBundledSkills()).toContainEqual(
      expect.objectContaining({
        name: 'skillify',
        source: 'bundled',
        userInvocable: true,
      }),
    )
  })
})
