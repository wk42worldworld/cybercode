import { describe, expect, test } from 'bun:test'
import { hasLinkedSearchResults } from './results.js'

describe('hasLinkedSearchResults', () => {
  test('rejects model commentary without actual links', () => {
    expect(
      hasLinkedSearchResults([
        'I will search the web now.',
        'I do not have access to web search.',
      ]),
    ).toBe(false)
  })

  test('accepts a real linked result block', () => {
    expect(
      hasLinkedSearchResults([
        {
          content: [{ url: 'https://example.com/result' }],
        },
      ]),
    ).toBe(true)
  })
})
