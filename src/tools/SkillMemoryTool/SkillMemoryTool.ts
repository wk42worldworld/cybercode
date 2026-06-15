import { z } from 'zod/v4'
import { getProjectRoot } from '../../bootstrap/state.js'
import {
  loadGovernedSkills,
  mergeSkillMemorySummaries,
  runSkillMemoryGovernance,
} from '../../skillMemory/governance.js'
import {
  readSkillMemoryStats,
  readSkillMemorySummary,
  setSkillLifecycleStatus,
} from '../../skillMemory/store.js'
import { buildTool } from '../../Tool.js'
import type { Command } from '../../types/command.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { SKILL_MEMORY_TOOL_NAME } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'

const actionSchema = z.enum([
  'governance',
  'read',
  'set-status',
  'merge-summary',
])
const statusSchema = z.enum(['active', 'stale', 'archived', 'pinned'])

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: actionSchema.describe('Skill memory operation to perform.'),
    skillName: z
      .string()
      .optional()
      .describe('Skill name for read or set-status.'),
    status: statusSchema
      .optional()
      .describe('Lifecycle status for set-status.'),
    targetSkillName: z
      .string()
      .optional()
      .describe('Target skill that receives merged SUMMARY.md notes.'),
    sourceSkillNames: z
      .array(z.string())
      .optional()
      .describe('Source skills whose SUMMARY.md notes should be merged.'),
    applyStatus: z
      .boolean()
      .optional()
      .describe('For governance, write stale/archive status changes. Defaults to true.'),
    mergeMemory: z
      .boolean()
      .optional()
      .describe('For governance, also merge duplicate skill SUMMARY.md notes. Defaults to false.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
type Input = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z
    .object({
      success: z.boolean(),
      action: actionSchema,
      message: z.string(),
    })
    .passthrough(),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

function requireName(name: string | undefined, field = 'skillName'): string {
  const trimmed = name?.trim()
  if (!trimmed) throw new Error(`${field} is required`)
  return trimmed
}

async function findGovernedSkill(
  name: string,
  commands: readonly Command[],
  projectRoot: string,
) {
  const skills = await loadGovernedSkills({ commands, projectRoot })
  const skill = skills.find(item => item.command.name === name)
  if (!skill) throw new Error(`Skill not found: ${name}`)
  return { skill, skills }
}

export const SkillMemoryTool = buildTool({
  name: SKILL_MEMORY_TOOL_NAME,
  searchHint: 'inspect govern skill memory',
  maxResultSizeChars: 30_000,
  strict: true,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'SkillMemory'
  },
  isConcurrencySafe(input: Input) {
    return (
      input.action === 'read' ||
      (input.action === 'governance' &&
        input.applyStatus === false &&
        input.mergeMemory !== true)
    )
  },
  isReadOnly(input: Input) {
    return (
      input.action === 'read' ||
      (input.action === 'governance' &&
        input.applyStatus === false &&
        input.mergeMemory !== true)
    )
  },
  isDestructive() {
    return false
  },
  async checkPermissions(input) {
    return { behavior: 'allow' as const, updatedInput: input }
  },
  renderToolUseMessage(input: Input) {
    if (input.action === 'read') {
      return `Read skill memory ${input.skillName ?? ''}`.trim()
    }
    if (input.action === 'set-status') {
      return `Set skill memory status ${input.skillName ?? ''}`.trim()
    }
    if (input.action === 'merge-summary') {
      return `Merge skill memory into ${input.targetSkillName ?? ''}`.trim()
    }
    return 'Run skill memory governance'
  },
  async call(input: Input, context): Promise<{ data: Output }> {
    const projectRoot = getProjectRoot()

    switch (input.action) {
      case 'governance': {
        const report = await runSkillMemoryGovernance({
          commands: context.options.commands,
          projectRoot,
          applyStatus: input.applyStatus ?? true,
          mergeMemory: input.mergeMemory ?? false,
        })
        return {
          data: {
            success: true,
            action: input.action,
            message: 'Skill memory governance completed.',
            report,
          },
        }
      }
      case 'read': {
        const name = requireName(input.skillName)
        const { skill } = await findGovernedSkill(
          name,
          context.options.commands,
          projectRoot,
        )
        const [stats, summary] = await Promise.all([
          readSkillMemoryStats(skill.ref, skill.scope),
          readSkillMemorySummary(skill.ref, skill.scope, {
            includeArchived: true,
          }),
        ])
        return {
          data: {
            success: true,
            action: input.action,
            message: `Skill memory loaded for /${name}.`,
            skillName: name,
            scope: skill.scope,
            stats,
            summary,
          },
        }
      }
      case 'set-status': {
        const name = requireName(input.skillName)
        if (!input.status) throw new Error('status is required')
        const { skill } = await findGovernedSkill(
          name,
          context.options.commands,
          projectRoot,
        )
        const stats = await setSkillLifecycleStatus({
          ref: skill.ref,
          scope: skill.scope,
          status: input.status,
        })
        return {
          data: {
            success: true,
            action: input.action,
            message: `Skill /${name} marked ${input.status}.`,
            skillName: name,
            stats,
          },
        }
      }
      case 'merge-summary': {
        const targetName = requireName(input.targetSkillName, 'targetSkillName')
        const sourceNames = input.sourceSkillNames
          ?.map(name => name.trim())
          .filter(Boolean)
        if (!sourceNames?.length) throw new Error('sourceSkillNames is required')
        const { skills } = await findGovernedSkill(
          targetName,
          context.options.commands,
          projectRoot,
        )
        const target = skills.find(item => item.command.name === targetName)
        const sources = skills.filter(item =>
          sourceNames.includes(item.command.name),
        )
        if (!target) throw new Error(`Skill not found: ${targetName}`)
        if (sources.length !== sourceNames.length) {
          const found = new Set(sources.map(item => item.command.name))
          const missing = sourceNames.filter(name => !found.has(name))
          throw new Error(`Source skill not found: ${missing.join(', ')}`)
        }
        const changed = await mergeSkillMemorySummaries({ target, sources })
        return {
          data: {
            success: true,
            action: input.action,
            changed,
            message: changed
              ? `Merged SUMMARY.md notes into /${targetName}.`
              : `No SUMMARY.md notes needed merging into /${targetName}.`,
            targetSkillName: targetName,
            sourceSkillNames: sourceNames,
          },
        }
      }
    }
  },
})
