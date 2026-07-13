import { describe, expect, it } from 'vitest'
import { en } from './locales/en'
import { ja } from './locales/ja'
import { ko } from './locales/ko'
import { zh } from './locales/zh'

describe('desktop product identity', () => {
  it.each([en, zh, ja, ko])(
    'uses CyberCode for the generic empty-session experience',
    locale => {
      expect(locale['empty.subtitle']).toContain('CyberCode')
      expect(locale['permMode.autoAcceptDesc']).toContain('CyberCode')
    },
  )

  it('uses CyberCode for generic permission prompts', () => {
    expect(en['permission.allowBash']).toContain('CyberCode')
    expect(en['permission.allowTool']).toContain('CyberCode')
    expect(zh['permission.allowBash']).toContain('CyberCode')
    expect(zh['permission.allowTool']).toContain('CyberCode')
  })
})
