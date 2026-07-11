import { randomUUID } from 'crypto'
import { getInvokedSkillsForAgent, getSessionId } from '../bootstrap/state.js'
import type { QuerySource } from '../constants/querySource.js'
import { queryModelWithoutStreaming } from '../services/api/claude.js'
import { getEmptyToolPermissionContext } from '../Tool.js'
import type { Message } from '../types/message.js'
import { createAbortController } from '../utils/abortController.js'
import { getProjectRoot } from '../bootstrap/state.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import { isEnvDefinedFalsy } from '../utils/envUtils.js'
import type { REPLHookContext } from '../utils/hooks/postSamplingHooks.js'
import {
  createSystemMessage,
  createUserMessage,
  extractTag,
  extractTextContent,
} from '../utils/messages.js'
import { getSmallFastModel } from '../utils/model/model.js'
import { asSystemPrompt } from '../utils/systemPromptType.js'
import {
  appendSkillMemoryPending,
  movePendingToEvidence,
  parseInvokedSkillMemoryRef,
  readSkillMemoryPending,
  readSkillMemorySummary,
  writeSkillMemorySummary,
  type SkillMemoryPendingEntry,
} from './store.js'
import type { SkillMemoryRef, SkillMemoryScope } from './paths.js'

const REVIEW_MIN_PENDING = 3
const REVIEW_PENDING_LIMIT = 12
const EXCERPT_CHAR_LIMIT = 1_200
const SKILL_MEMORY_NOTICE_TOOL_USE_ID = 'skill_memory_auto_review'

const recordedInvocations = new Set<string>()
const inFlightReviews = new Set<string>()

type ReviewTarget = {
  ref: SkillMemoryRef
  scope: SkillMemoryScope
}

function getReviewMinPending(): number {
  const raw = Number(process.env.CYBER_SKILL_MEMORY_REVIEW_MIN_PENDING)
  return Number.isFinite(raw) && raw > 0 ? raw : REVIEW_MIN_PENDING
}

function isAutoReviewEnabled(): boolean {
  return !isEnvDefinedFalsy(process.env.CYBER_SKILL_MEMORY_AUTO_REVIEW)
}

function getTargetKey(target: ReviewTarget): string {
  return `${target.scope}:${target.ref.source ?? ''}:${target.ref.skillName}`
}

function truncate(text: string, limit: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= limit) return trimmed
  return `${trimmed.slice(0, limit - 1).trimEnd()}…`
}

function messageToText(message: Message): string {
  if (message.type !== 'user' && message.type !== 'assistant') return ''
  if ((message as { isMeta?: boolean }).isMeta) return ''
  const content = message.message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return extractTextContent(content, '\n')
}

function formatRecentConversationExcerpt(messages: Message[]): string {
  return truncate(
    messages
      .filter(message => {
        if (message.type !== 'user' && message.type !== 'assistant') return false
        return !(message as { isMeta?: boolean }).isMeta
      })
      .slice(-6)
      .map(message => {
        const role = message.type === 'user' ? 'User' : 'Assistant'
        return `${role}: ${messageToText(message)}`
      })
      .filter(Boolean)
      .join('\n\n'),
    EXCERPT_CHAR_LIMIT,
  )
}

function inferScope(ref: SkillMemoryRef): SkillMemoryScope {
  return ref.source === 'projectSettings' ? 'project' : 'global'
}

async function collectInvokedSkillMemoryCandidates(
  context: REPLHookContext,
): Promise<ReviewTarget[]> {
  const invoked = getInvokedSkillsForAgent(null)
  if (invoked.size === 0) return []

  const projectRoot = getProjectRoot()
  const sessionId = getSessionId()
  const excerpt = formatRecentConversationExcerpt(context.messages)
  const targets: ReviewTarget[] = []

  for (const skill of invoked.values()) {
    const invocationKey = `${sessionId}:${skill.skillName}:${skill.invokedAt}`
    if (recordedInvocations.has(invocationKey)) continue
    recordedInvocations.add(invocationKey)

    const ref = parseInvokedSkillMemoryRef({
      skillName: skill.skillName,
      skillPath: skill.skillPath,
      projectRoot,
    })
    const scope = inferScope(ref)
    const observedAt = new Date(skill.invokedAt).toISOString()

    await appendSkillMemoryPending(ref, scope, {
      id: randomUUID(),
      observedAt,
      trigger: 'invoked',
      skillPath: skill.skillPath,
      sessionId,
      excerpt,
    }).catch(error => {
      logForDebugging(
        `[skill-memory] pending write failed for ${skill.skillName}: ${errorMessage(error)}`,
      )
    })

    targets.push({ ref, scope })
  }

  return targets
}

function formatPendingForPrompt(entries: SkillMemoryPendingEntry[]): string {
  return entries
    .map((entry, index) =>
      [
        `### Observation ${index + 1}`,
        `Time: ${entry.observedAt}`,
        `Trigger: ${entry.trigger}`,
        entry.excerpt ? `Excerpt:\n${entry.excerpt}` : 'Excerpt: none',
      ].join('\n'),
    )
    .join('\n\n')
}

export function buildSkillMemoryReviewPrompt(params: {
  skillName: string
  currentSummary: string
  pending: SkillMemoryPendingEntry[]
}): string {
  return [
    'You are the automatic Skill Memory reviewer for CyberCode.',
    '',
    `Skill: ${params.skillName}`,
    '',
    'Your job is to distill repeated, durable lessons about how this skill should be used in future CyberCode sessions.',
    '',
    'Current SUMMARY.md:',
    params.currentSummary.trim() || '(empty)',
    '',
    'Pending observations:',
    formatPendingForPrompt(params.pending),
    '',
    'Rules:',
    '- Output a compact SUMMARY.md inside <summary> tags.',
    '- Keep the summary under 2,500 characters.',
    '- Prefer stable usage guidance, project conventions, recurring pitfalls, and user corrections.',
    '- Do not store secrets, tokens, one-off tasks, transient plans, or details only useful in the current conversation.',
    '- Do not create a new skill and do not edit SKILL.md.',
    '- Merge with the current summary instead of duplicating points.',
    '- If nothing durable should be remembered, reply exactly: No skill-memory changes.',
  ].join('\n')
}

async function runSkillMemoryReview(
  target: ReviewTarget,
  model: string,
): Promise<boolean> {
  const key = getTargetKey(target)
  if (inFlightReviews.has(key)) return false
  inFlightReviews.add(key)

  try {
    const pending = await readSkillMemoryPending(target.ref, target.scope, {
      limit: REVIEW_PENDING_LIMIT,
      newestFirst: false,
    })
    if (pending.length < getReviewMinPending()) return false

    const currentSummary =
      (await readSkillMemorySummary(target.ref, target.scope))?.content ?? ''
    const prompt = buildSkillMemoryReviewPrompt({
      skillName: target.ref.skillName,
      currentSummary,
      pending,
    })

    const response = await queryModelWithoutStreaming({
      messages: [createUserMessage({ content: prompt })],
      systemPrompt: asSystemPrompt([
        'You maintain compact, local skill memory summaries. You never edit skill files directly.',
      ]),
      thinkingConfig: { type: 'disabled' as const },
      tools: [],
      signal: createAbortController().signal,
      options: {
        getToolPermissionContext: async () => getEmptyToolPermissionContext(),
        model: model || getSmallFastModel(),
        toolChoice: undefined,
        isNonInteractiveSession: false,
        hasAppendSystemPrompt: false,
        temperatureOverride: 0,
        agents: [],
        querySource: 'skill_memory_review' as QuerySource,
        mcpTools: [],
      },
    })

    const text = extractTextContent(response.message.content).trim()
    const updatedSummary = extractTag(text, 'summary')?.trim()

    if (updatedSummary && updatedSummary !== currentSummary.trim()) {
      await writeSkillMemorySummary(target.ref, target.scope, updatedSummary)
      await movePendingToEvidence({
        ref: target.ref,
        scope: target.scope,
        consumedCount: pending.length,
      })
      return true
    }

    if (text === 'No skill-memory changes.' || !updatedSummary) {
      await movePendingToEvidence({
        ref: target.ref,
        scope: target.scope,
        consumedCount: pending.length,
      })
    }

    return false
  } catch (error) {
    logForDebugging(
      `[skill-memory] review failed for ${target.ref.skillName}: ${errorMessage(error)}`,
      { level: 'debug' },
    )
    return false
  } finally {
    inFlightReviews.delete(key)
  }
}

export async function executeSkillMemoryLifecycleReview(
  context: REPLHookContext,
): Promise<void> {
  if (
    context.querySource !== 'repl_main_thread' &&
    context.querySource !== 'sdk'
  ) {
    return
  }
  if (context.toolUseContext.agentId) return

  const collected = await collectInvokedSkillMemoryCandidates(context)
  if (!isAutoReviewEnabled() || collected.length === 0) return

  const uniqueTargets = Array.from(
    new Map(collected.map(target => [getTargetKey(target), target])).values(),
  )

  for (const target of uniqueTargets) {
    const changed = await runSkillMemoryReview(
      target,
      context.toolUseContext.options.mainLoopModel,
    )
    if (changed) {
      context.toolUseContext.appendSystemMessage?.(
        createSystemMessage(
          `技能记忆已更新：${target.ref.skillName}，下次调用该技能时生效。`,
          'suggestion',
          SKILL_MEMORY_NOTICE_TOOL_USE_ID,
        ),
      )
    }
  }
}

export function resetSkillMemoryLifecycleForTesting(): void {
  recordedInvocations.clear()
  inFlightReviews.clear()
}
