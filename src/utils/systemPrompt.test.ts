import { describe, expect, test } from 'bun:test'
import {
  buildEffectiveSystemPrompt,
  getPromptMemorySections,
} from './systemPrompt.js'

const PROMPT_MEMORY_SECTION = [
  '# CyberCode Soul',
  '',
  'CyberCode has a durable identity.',
  '',
  '# Prompt Memory',
  '',
  '## User',
  '',
  'User calls CyberCode 零.',
].join('\n')

function buildPrompt(params: {
  customSystemPrompt?: string
  agentPrompt?: string
  appendSystemPrompt?: string
}): readonly string[] {
  const mainThreadAgentDefinition = params.agentPrompt
    ? {
        agentType: 'custom-test-agent',
        whenToUse: 'test',
        source: 'user',
        getSystemPrompt: () => params.agentPrompt!,
      }
    : undefined

  return buildEffectiveSystemPrompt({
    mainThreadAgentDefinition: mainThreadAgentDefinition as any,
    toolUseContext: { options: {} } as any,
    customSystemPrompt: params.customSystemPrompt,
    defaultSystemPrompt: [
      'Default static coding instructions.',
      PROMPT_MEMORY_SECTION,
      'Default environment info.',
    ],
    appendSystemPrompt: params.appendSystemPrompt,
  })
}

describe('system prompt assembly', () => {
  test('detects prompt-memory sections in the default prompt', () => {
    expect(
      getPromptMemorySections([
        'Default static coding instructions.',
        PROMPT_MEMORY_SECTION,
      ]),
    ).toEqual([PROMPT_MEMORY_SECTION])
  })

  test('preserves prompt memory when a custom system prompt replaces defaults', () => {
    const prompt = buildPrompt({
      customSystemPrompt: 'Custom task behavior.',
      appendSystemPrompt: 'Append-only guardrail.',
    })

    expect(prompt).toContain(PROMPT_MEMORY_SECTION)
    expect(prompt).toContain('Custom task behavior.')
    expect(prompt).toContain('Append-only guardrail.')
    expect(prompt).not.toContain('Default static coding instructions.')
    expect(prompt).not.toContain('Default environment info.')
  })

  test('preserves prompt memory when an agent prompt replaces defaults', () => {
    const prompt = buildPrompt({
      agentPrompt: 'Agent-specific behavior.',
    })

    expect(prompt).toContain(PROMPT_MEMORY_SECTION)
    expect(prompt).toContain('Agent-specific behavior.')
    expect(prompt).not.toContain('Default static coding instructions.')
  })
})
