import { describe, expect, test } from 'bun:test'
import { shouldRunCodeGraphPreflight } from './codeGraphPreflight.js'

describe('Code Graph automatic preflight gate', () => {
  test('runs for structural questions in Chinese and English', () => {
    expect(shouldRunCodeGraphPreflight('这个登录模块的调用链和影响范围是什么？')).toBe(true)
    expect(shouldRunCodeGraphPreflight('Trace the dependency flow from createSession')).toBe(true)
  })

  test('runs for code-shaped symbols paired with an implementation action', () => {
    expect(shouldRunCodeGraphPreflight('帮我修改 CodeGraphService.getVisualization')).toBe(true)
    expect(shouldRunCodeGraphPreflight('Fix desktop/src/App.tsx')).toBe(true)
  })

  test('does not spend graph work on ordinary chat or bare slash commands', () => {
    expect(shouldRunCodeGraphPreflight('今天天气不错，我们聊聊天吧')).toBe(false)
    expect(shouldRunCodeGraphPreflight('/help')).toBe(false)
  })
})
