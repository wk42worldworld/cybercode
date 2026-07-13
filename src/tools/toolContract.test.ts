import { describe, expect, test } from 'bun:test'
import { getAllBaseTools } from '../tools.js'
import { SessionSearchTool } from './SessionSearchTool/SessionSearchTool.js'
import { SkillGateTool } from './SkillGateTool/SkillGateTool.js'
import { SkillMemoryTool } from './SkillMemoryTool/SkillMemoryTool.js'

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
})
