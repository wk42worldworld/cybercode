import { describe, expect, it } from 'bun:test'
import { getCoordinatorSystemPrompt } from '../coordinator/coordinatorMode.js'
import { DEFAULT_AGENT_PROMPT } from './prompts.js'
import { CLI_SYSPROMPT_PREFIXES } from './system.js'

describe('CyberCode product identity', () => {
  it('uses CyberCode in every core system prompt prefix', () => {
    for (const prefix of CLI_SYSPROMPT_PREFIXES) {
      expect(prefix).toContain('CyberCode')
      expect(prefix).not.toContain('Claude Code')
    }
  })

  it('uses CyberCode for delegated and coordinator agents', () => {
    const prompts = [DEFAULT_AGENT_PROMPT, getCoordinatorSystemPrompt()]

    for (const prompt of prompts) {
      expect(prompt).toContain('CyberCode')
      expect(prompt).not.toContain('You are Claude Code')
      expect(prompt).not.toContain('agent for Claude Code')
    }
  })
})
