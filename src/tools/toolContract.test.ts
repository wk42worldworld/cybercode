import { describe, expect, test } from 'bun:test'
import { getAllBaseTools } from '../tools.js'
import { SessionSearchTool } from './SessionSearchTool/SessionSearchTool.js'
import { SkillGateTool } from './SkillGateTool/SkillGateTool.js'
import { SkillMemoryTool } from './SkillMemoryTool/SkillMemoryTool.js'
import { BashTool } from './BashTool/BashTool.js'
import { GrepTool } from './GrepTool/GrepTool.js'

describe('tool result contract', () => {
  test('every base tool can map its result for the model', () => {
    const missing = getAllBaseTools()
      .filter(tool => typeof tool.mapToolResultToToolResultBlockParam !== 'function')
      .map(tool => tool.name)

    expect(missing).toEqual([])
  })

  test.each([
    ['SessionSearch', SessionSearchTool],
    ['SkillGate', SkillGateTool],
    ['SkillMemory', SkillMemoryTool],
  ] as const)('%s emits a valid tool_result block', (_name, tool) => {
    const block = tool.mapToolResultToToolResultBlockParam(
      { success: true } as never,
      'tool-use-1',
    )

    expect(block).toEqual({
      type: 'tool_result',
      tool_use_id: 'tool-use-1',
      content: '{"success":true}',
    })
  })

  test('search tools append automatic graph context only to the model result', () => {
    const grep = GrepTool.mapToolResultToToolResultBlockParam({
      mode: 'files_with_matches',
      numFiles: 2,
      filenames: ['src/a.ts', 'src/b.ts'],
      graphContext: '<codegraph_context>impact</codegraph_context>',
    }, 'grep-1')
    const bash = BashTool.mapToolResultToToolResultBlockParam({
      stdout: 'src/a.ts\nsrc/b.ts',
      stderr: '',
      interrupted: false,
      graphContext: '<codegraph_context>impact</codegraph_context>',
    }, 'bash-1')

    expect(grep.content).toContain('<codegraph_context>impact</codegraph_context>')
    expect(bash.content).toContain('<codegraph_context>impact</codegraph_context>')
  })
})
