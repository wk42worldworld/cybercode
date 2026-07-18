import { describe, expect, test } from 'bun:test'
import {
  estimateCodeGraphTokens,
  limitTextToTokenBudget,
} from './codegraph-runner'

describe('Code Graph MCP output budgets', () => {
  test('preserves context that already fits', () => {
    const text = 'small graph result'
    expect(limitTextToTokenBudget(text, 100)).toBe(text)
  })

  test('truncates mixed code and CJK text within the requested estimate', () => {
    const text = `${'const value = dependency.call()\n'.repeat(120)}${'架构调用关系'.repeat(120)}`
    const result = limitTextToTokenBudget(text, 180)

    expect(estimateCodeGraphTokens(result)).toBeLessThanOrEqual(180)
    expect(result).toContain('context truncated')
    expect(result.length).toBeLessThan(text.length)
  })
})
