import { z } from 'zod/v4'
import {
  evaluateSkillCreationCandidate,
  rankSkillGateMatches,
  type SkillGateCandidate,
  type SkillGateDecision,
  type SkillGateMatch,
} from '../../skillMemory/gate.js'
import { buildTool } from '../../Tool.js'
import type { Command } from '../../types/command.js'
import { parseFrontmatter } from '../../utils/frontmatterParser.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { SKILL_GATE_TOOL_NAME } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    name: z.string().optional().describe('Proposed skill name.'),
    description: z
      .string()
      .optional()
      .describe('Proposed frontmatter description.'),
    whenToUse: z
      .string()
      .optional()
      .describe('Proposed when_to_use / whenToUse guidance.'),
    markdown: z
      .string()
      .optional()
      .describe('Optional full proposed SKILL.md content to parse.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(8)
      .optional()
      .describe('Maximum number of similar existing skills to return.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
type Input = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    decision: z.enum(['reuse', 'merge', 'create']),
    message: z.string(),
    candidate: z.object({
      name: z.string(),
      description: z.string().optional(),
      whenToUse: z.string().optional(),
    }),
    bestMatch: z
      .object({
        skillName: z.string(),
        score: z.number(),
        reason: z.string(),
        description: z.string().optional(),
        whenToUse: z.string().optional(),
        source: z.string().optional(),
        loadedFrom: z.string().optional(),
      })
      .optional(),
    matches: z.array(
      z.object({
        skillName: z.string(),
        score: z.number(),
        reason: z.string(),
        description: z.string().optional(),
        whenToUse: z.string().optional(),
        source: z.string().optional(),
        loadedFrom: z.string().optional(),
      }),
    ),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

function stringFrom(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function candidateFromInput(input: Input): SkillGateCandidate {
  const frontmatter = input.markdown
    ? parseFrontmatter(input.markdown, 'proposed SKILL.md').frontmatter
    : {}
  const name = input.name?.trim() || stringFrom(frontmatter.name)

  if (!name) {
    throw new Error('name is required, either directly or in SKILL.md frontmatter')
  }

  return {
    name,
    description:
      input.description?.trim() || stringFrom(frontmatter.description),
    whenToUse:
      input.whenToUse?.trim() ||
      stringFrom(frontmatter.when_to_use) ||
      stringFrom(frontmatter.whenToUse),
  }
}

function isComparableSkill(command: Command): boolean {
  return (
    command.type === 'prompt' &&
    command.source !== 'builtin' &&
    (command.loadedFrom === 'bundled' ||
      command.loadedFrom === 'skills' ||
      command.loadedFrom === 'commands_DEPRECATED' ||
      command.loadedFrom === 'plugin' ||
      command.loadedFrom === 'mcp' ||
      command.hasUserSpecifiedDescription ||
      Boolean(command.whenToUse))
  )
}

function roundMatch(match: SkillGateMatch): SkillGateMatch {
  return {
    ...match,
    score: Math.round(match.score * 1000) / 1000,
  }
}

function messageForDecision(
  decision: SkillGateDecision,
  bestMatch: SkillGateMatch | undefined,
): string {
  if (decision === 'reuse' && bestMatch) {
    return `Reuse existing skill /${bestMatch.skillName}; do not create a duplicate SKILL.md.`
  }
  if (decision === 'merge' && bestMatch) {
    return `Proposed skill overlaps /${bestMatch.skillName}; merge or narrow the idea before creating a new skill.`
  }
  return 'No close duplicate skill found; creating a new skill is reasonable after normal confirmation.'
}

export const SkillGateTool = buildTool({
  name: SKILL_GATE_TOOL_NAME,
  searchHint: 'deduplicate proposed skills',
  maxResultSizeChars: 20_000,
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
    return 'SkillGate'
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  isDestructive() {
    return false
  },
  async checkPermissions(input) {
    return { behavior: 'allow' as const, updatedInput: input }
  },
  renderToolUseMessage(input: Input) {
    const name = input.name?.trim() || 'proposed skill'
    return `Check duplicate skill gate for ${name}`
  },
  async call(input: Input, context): Promise<{ data: Output }> {
    const candidate = candidateFromInput(input)
    const existingSkills = context.options.commands.filter(isComparableSkill)
    const result = evaluateSkillCreationCandidate({
      candidate,
      existingSkills,
    })
    const matches = rankSkillGateMatches({
      candidate,
      existingSkills,
      limit: input.limit ?? 5,
    }).map(roundMatch)
    const bestMatch = result.bestMatch ? roundMatch(result.bestMatch) : undefined

    return {
      data: {
        success: true,
        decision: result.decision,
        message: messageForDecision(result.decision, bestMatch),
        candidate,
        bestMatch,
        matches,
      },
    }
  },
})
