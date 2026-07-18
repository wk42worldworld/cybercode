import { createHash } from 'crypto'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { getProjectRoot, getSessionId } from '../bootstrap/state.js'
import type { QuerySource } from '../constants/querySource.js'
import { evaluateSkillCreationCandidate } from '../skillMemory/gate.js'
import { queryModelWithoutStreaming } from '../services/api/claude.js'
import { redactSecrets } from '../services/teamMemorySync/secretScanner.js'
import { getEmptyToolPermissionContext } from '../Tool.js'
import type { Command } from '../types/command.js'
import type { Message } from '../types/message.js'
import { createAbortController } from '../utils/abortController.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import type { REPLHookContext } from '../utils/hooks/postSamplingHooks.js'
import {
  createSystemMessage,
  createUserMessage,
  extractTag,
  extractTextContent,
} from '../utils/messages.js'
import { getSmallFastModel } from '../utils/model/model.js'
import { asSystemPrompt } from '../utils/systemPromptType.js'
import { approveSkillCandidate } from './approval.js'
import {
  readSkillLearningConfig,
  recordSkillLearningEvent,
  saveSkillCandidate,
  updateSkillCandidate,
} from './store.js'
import type {
  SkillCandidate,
  SkillCandidateAction,
  SkillCandidateScope,
  SkillCandidateTarget,
  SkillLearningConfig,
} from './types.js'

const REVIEW_EXCERPT_LIMIT = 14_000
const REVIEW_MESSAGE_LIMIT = 18
const REVIEWED_TURN_LIMIT = 500
const SKILL_LEARNING_NOTICE_TOOL_USE_ID = 'skill_learning_review'

const reviewedTurns = new Map<string, true>()
const inFlightReviews = new Set<string>()
const pendingReviews = new Map<string, REPLHookContext>()
const inFlightReviewPromises = new Set<Promise<void>>()

type RawSkillCandidate = {
  name: string
  description: string
  whenToUse: string
  scope: SkillCandidateScope
  reason: string
  confidence: number
  evidence: string[]
  body: string
}

export type SkillReviewEligibility = {
  eligible: boolean
  reason: string
  toolUseCount: number
  userTurnCount: number
  correctionSignal: boolean
  fingerprint: string
  excerpt: string
}

export function shouldAutoApproveSkillCandidate(
  config: SkillLearningConfig,
  candidate: Pick<SkillCandidate, 'action' | 'scope' | 'confidence' | 'duplicate'>,
): boolean {
  return config.mode === 'auto' &&
    candidate.confidence >= config.autoApproveConfidence
}

function rememberReviewedTurn(fingerprint: string): boolean {
  if (reviewedTurns.has(fingerprint)) return false
  reviewedTurns.set(fingerprint, true)
  if (reviewedTurns.size > REVIEWED_TURN_LIMIT) {
    const oldest = reviewedTurns.keys().next().value
    if (oldest) reviewedTurns.delete(oldest)
  }
  return true
}

function getMessageText(message: Message): string {
  if (message.type !== 'user' && message.type !== 'assistant') return ''
  const content = message.message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return extractTextContent(content, '\n')
}

function isVisibleConversationMessage(message: Message): boolean {
  if (message.type !== 'user' && message.type !== 'assistant') return false
  return !(message as { isMeta?: boolean }).isMeta
}

function getContentBlocks(message: Message): Array<Record<string, unknown>> {
  if (message.type !== 'user' && message.type !== 'assistant') return []
  const content = message.message.content
  return Array.isArray(content)
    ? content.filter(
        (block): block is Record<string, unknown> =>
          Boolean(block) && typeof block === 'object',
      )
    : []
}

function countToolUses(messages: Message[]): number {
  return messages.reduce(
    (total, message) =>
      total +
      getContentBlocks(message).filter(block => block.type === 'tool_use').length,
    0,
  )
}

function hasCorrectionSignal(messages: Message[]): boolean {
  const recentUserText = messages
    .filter(message => message.type === 'user' && isVisibleConversationMessage(message))
    .slice(-4)
    .map(getMessageText)
    .join('\n')
    .toLowerCase()

  return /(?:\b(?:no|instead|always|never|actually|make sure|don't|do not|wrong)\b|不对|不要|改成|应该|必须|每次|总是|而不是|记住|修正|订正|いいえ|代わりに|必ず|아니|대신|항상)/i.test(
    recentUserText,
  )
}

function truncate(value: string, limit: number): string {
  const trimmed = value.trim()
  if (trimmed.length <= limit) return trimmed
  return `${trimmed.slice(0, limit - 1).trimEnd()}…`
}

function formatToolUse(block: Record<string, unknown>): string {
  const name = typeof block.name === 'string' ? block.name : 'Tool'
  const input = block.input
  let inputText = ''
  try {
    inputText = truncate(JSON.stringify(input), 500)
  } catch {
    inputText = '[unserializable input]'
  }
  return `Assistant tool: ${name}${inputText ? ` ${inputText}` : ''}`
}

function formatReviewExcerpt(messages: Message[]): string {
  const lines: string[] = []
  for (const message of messages.slice(-REVIEW_MESSAGE_LIMIT)) {
    if (!isVisibleConversationMessage(message)) continue
    const role = message.type === 'user' ? 'User' : 'Assistant'
    const text = truncate(getMessageText(message), role === 'User' ? 1_400 : 1_800)
    if (text) lines.push(`${role}: ${text}`)
    for (const block of getContentBlocks(message)) {
      if (block.type === 'tool_use') lines.push(formatToolUse(block))
      if (block.type === 'tool_result') {
        lines.push(
          `Tool result: ${(block as { is_error?: boolean }).is_error ? 'error' : 'success'}`,
        )
      }
    }
  }
  return truncate(redactSecrets(lines.join('\n\n')), REVIEW_EXCERPT_LIMIT)
}

function turnFingerprint(params: {
  sessionId: string
  projectRoot: string
  excerpt: string
}): string {
  return createHash('sha256')
    .update(`${params.sessionId}\0${params.projectRoot}\0${params.excerpt}`)
    .digest('hex')
}

export function evaluateSkillReviewEligibility(
  messages: Message[],
  config: SkillLearningConfig,
  params: { sessionId?: string; projectRoot?: string } = {},
): SkillReviewEligibility {
  const visibleMessages = messages.filter(isVisibleConversationMessage)
  const userIndexes = visibleMessages
    .map((message, index) => (message.type === 'user' ? index : -1))
    .filter(index => index >= 0)
  const reviewStart = userIndexes[Math.max(0, userIndexes.length - 3)] ?? 0
  const recentTaskMessages = visibleMessages.slice(reviewStart)
  const toolUseCount = countToolUses(recentTaskMessages)
  const userTurnCount = userIndexes.length
  const correctionSignal = hasCorrectionSignal(visibleMessages)
  const excerpt = formatReviewExcerpt(recentTaskMessages)
  const fingerprint = turnFingerprint({
    sessionId: params.sessionId ?? 'unknown-session',
    projectRoot: params.projectRoot ?? '',
    excerpt,
  })

  if (config.mode === 'off') {
    return {
      eligible: false,
      reason: 'Skill Learning is disabled.',
      toolUseCount,
      userTurnCount,
      correctionSignal,
      fingerprint,
      excerpt,
    }
  }
  if (!excerpt) {
    return {
      eligible: false,
      reason: 'No visible conversation content to review.',
      toolUseCount,
      userTurnCount,
      correctionSignal,
      fingerprint,
      excerpt,
    }
  }

  const correctionThreshold = Math.max(2, config.minToolUses - 3)
  const eligible =
    toolUseCount >= config.minToolUses ||
    (correctionSignal && toolUseCount >= correctionThreshold)

  return {
    eligible,
    reason: eligible
      ? correctionSignal
        ? 'Complex task with reusable user corrections.'
        : 'Complex task exceeded the tool-use learning threshold.'
      : `Task used ${toolUseCount} tools; ${config.minToolUses} required.`,
    toolUseCount,
    userTurnCount,
    correctionSignal,
    fingerprint,
    excerpt,
  }
}

function yamlString(value: string): string {
  return JSON.stringify(value.trim())
}

function normalizeSkillName(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
}

function buildSkillMarkdown(params: {
  candidate: Omit<RawSkillCandidate, 'body'>
  body: string
  sessionId?: string
}): string {
  const title = params.candidate.name
    .split('-')
    .filter(Boolean)
    .map(part => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ')
  return [
    '---',
    `name: ${params.candidate.name}`,
    `description: ${yamlString(params.candidate.description)}`,
    `when_to_use: ${yamlString(params.candidate.whenToUse)}`,
    'user-invocable: true',
    'metadata:',
    '  cybercode:',
    '    created_by: skill-learning',
    ...(params.sessionId
      ? [`    source_session: ${yamlString(params.sessionId)}`]
      : []),
    `    confidence: ${params.candidate.confidence.toFixed(2)}`,
    '---',
    '',
    params.body.trim().startsWith('#') ? params.body.trim() : `# ${title}\n\n${params.body.trim()}`,
    '',
  ].join('\n')
}

export function parseSkillCandidateResponse(
  text: string,
  params: { sessionId?: string } = {},
): { candidate?: RawSkillCandidate; noSkillReason?: string } {
  const noSkillReason = extractTag(text, 'no_skill')?.trim()
  if (noSkillReason) return { noSkillReason }

  const metadataText = extractTag(text, 'candidate')?.trim()
  const body = extractTag(text, 'skill_body')?.trim()
  if (!metadataText || !body) {
    throw new Error('Skill Learning review returned no structured candidate.')
  }

  const metadata = JSON.parse(metadataText) as Record<string, unknown>
  const name = normalizeSkillName(metadata.name)
  const description = typeof metadata.description === 'string'
    ? metadata.description.trim()
    : ''
  const whenToUse = typeof metadata.whenToUse === 'string'
    ? metadata.whenToUse.trim()
    : ''
  const scope = metadata.scope === 'global' ? 'global' : 'project'
  const reason = typeof metadata.reason === 'string' ? metadata.reason.trim() : ''
  const confidence = typeof metadata.confidence === 'number'
    ? Math.max(0, Math.min(1, metadata.confidence))
    : 0
  const evidence = Array.isArray(metadata.evidence)
    ? metadata.evidence
        .filter((item): item is string => typeof item === 'string')
        .map(item => truncate(item, 300))
        .slice(0, 5)
    : []

  if (!name || !description || !whenToUse || !reason || confidence <= 0) {
    throw new Error('Skill Learning candidate metadata is incomplete.')
  }

  const candidateBase = {
    name,
    description,
    whenToUse,
    scope,
    reason,
    confidence,
    evidence,
  }
  return {
    candidate: {
      ...candidateBase,
      body: buildSkillMarkdown({
        candidate: candidateBase,
        body,
        sessionId: params.sessionId,
      }),
    },
  }
}

function comparableSkills(commands: readonly Command[]): Command[] {
  return commands.filter(command =>
    command.type === 'prompt' &&
    command.source !== 'builtin' &&
    (command.loadedFrom === 'skills' ||
      command.loadedFrom === 'bundled' ||
      command.loadedFrom === 'plugin' ||
      command.loadedFrom === 'mcp' ||
      command.hasUserSpecifiedDescription ||
      Boolean(command.whenToUse))
  )
}

function formatSkillCatalog(commands: readonly Command[]): string {
  return comparableSkills(commands)
    .slice(0, 120)
    .map(command =>
      `- /${command.name}: ${truncate(command.description, 180)}${command.whenToUse ? ` | ${truncate(command.whenToUse, 180)}` : ''}`,
    )
    .join('\n') || '(none)'
}

export function buildSkillLearningPrompt(params: {
  excerpt: string
  projectRoot: string
  existingSkills: readonly Command[]
}): string {
  return [
    'You are CyberCode Skill Learning, a conservative procedural-memory reviewer.',
    '',
    'Review the completed task below and decide whether it contains a durable workflow worth reusing in future sessions.',
    'A good Skill captures a repeatable multi-step procedure, verified troubleshooting method, recurring user correction, or environment-specific operating workflow.',
    'Do not create a Skill for one-off facts, transient plans, simple questions, generic coding knowledge, secrets, credentials, or an unfinished/failed task.',
    'Prefer improving or reusing an existing Skill over creating a near-duplicate.',
    '',
    `Project root: ${params.projectRoot}`,
    '',
    'Existing Skills:',
    formatSkillCatalog(params.existingSkills),
    '',
    'Recent completed task:',
    params.excerpt,
    '',
    'If no durable Skill is justified, output:',
    '<no_skill>brief reason</no_skill>',
    '',
    'Otherwise output exactly two tags:',
    '<candidate>{"name":"english-kebab-case","description":"one sentence","whenToUse":"Use when... with trigger examples","scope":"project|global","reason":"why this is reusable","confidence":0.0,"evidence":["specific lesson"]}</candidate>',
    '<skill_body>Complete Markdown body with Goal, Inputs, Steps, per-step success criteria, Pitfalls, and Verification. Do not include YAML frontmatter.</skill_body>',
    '',
    'Use project scope for repository-specific commands, paths, architecture, or conventions. Use global scope only for a broadly reusable personal workflow.',
    'Confidence must reflect evidence quality. Never include API keys, tokens, private values, or raw conversation metadata.',
  ].join('\n')
}

async function runReviewModel(
  prompt: string,
  querySource: string,
  model: string,
): Promise<string> {
  const response = await queryModelWithoutStreaming({
    messages: [createUserMessage({ content: prompt })],
    systemPrompt: asSystemPrompt([
      'You convert completed work into concise, safe procedural Skill drafts. You may only return the requested tags and cannot write files or call tools.',
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
      querySource: querySource as QuerySource,
      mcpTools: [],
    },
  })
  return extractTextContent(response.message.content).trim()
}

function writableTarget(command: Command | undefined): {
  target: SkillCandidateTarget
  root: string
  scope: SkillCandidateScope
} | null {
  if (!command || command.type !== 'prompt' || !command.skillRoot) return null
  if (command.source === 'projectSettings') {
    return {
      target: { skillName: command.name, source: 'project' },
      root: command.skillRoot,
      scope: 'project',
    }
  }
  if (command.source === 'userSettings') {
    return {
      target: { skillName: command.name, source: 'user' },
      root: command.skillRoot,
      scope: 'global',
    }
  }
  return null
}

async function mergeWithExistingSkill(params: {
  command: Command
  currentMarkdown: string
  proposedMarkdown: string
  reason: string
  model: string
}): Promise<string> {
  const prompt = [
    'Update an existing CyberCode SKILL.md with a newly learned durable workflow lesson.',
    'Preserve useful existing guidance and all frontmatter fields. Do not add credentials or broaden allowed-tools permissions.',
    'Return the complete updated file inside <updated_skill> tags.',
    '',
    `Skill: /${params.command.name}`,
    `Reason for update: ${params.reason}`,
    '',
    '<current_skill>',
    params.currentMarkdown,
    '</current_skill>',
    '',
    '<proposed_learning>',
    params.proposedMarkdown,
    '</proposed_learning>',
  ].join('\n')
  const text = await runReviewModel(
    prompt,
    'skill_learning_merge',
    params.model,
  )
  const updated = extractTag(text, 'updated_skill')?.trim()
  if (!updated) throw new Error('Skill merge review returned no updated Skill.')
  return `${updated}\n`
}

async function reviewSkillLearningContext(
  context: REPLHookContext,
): Promise<void> {
  const config = await readSkillLearningConfig()
  const projectRoot = getProjectRoot()
  const sessionId = getSessionId()
  const eligibility = evaluateSkillReviewEligibility(context.messages, config, {
    projectRoot,
    sessionId,
  })
  if (!eligibility.eligible) {
    if (
      config.mode !== 'off' &&
      eligibility.excerpt &&
      (eligibility.toolUseCount > 0 || eligibility.correctionSignal) &&
      rememberReviewedTurn(eligibility.fingerprint)
    ) {
      await recordSkillLearningEvent({
        kind: 'review-skipped',
        message: eligibility.reason,
        projectRoot,
        sessionId,
        toolUseCount: eligibility.toolUseCount,
      }).catch(() => {})
    }
    return
  }
  if (!rememberReviewedTurn(eligibility.fingerprint)) return

  await recordSkillLearningEvent({
    kind: 'review-started',
    message: eligibility.reason,
    projectRoot,
    sessionId,
    toolUseCount: eligibility.toolUseCount,
  }).catch(() => {})

  try {
    const commands = context.toolUseContext.options.commands
    const responseText = await runReviewModel(
      buildSkillLearningPrompt({
        excerpt: eligibility.excerpt,
        projectRoot,
        existingSkills: commands,
      }),
      'skill_learning_review',
      context.toolUseContext.options.mainLoopModel,
    )
    const parsed = parseSkillCandidateResponse(responseText, { sessionId })
    if (!parsed.candidate) {
      await recordSkillLearningEvent({
        kind: 'no-candidate',
        message: parsed.noSkillReason || 'No durable workflow was found.',
        projectRoot,
        sessionId,
        toolUseCount: eligibility.toolUseCount,
      })
      return
    }
    if (parsed.candidate.confidence < config.minConfidence) {
      await recordSkillLearningEvent({
        kind: 'no-candidate',
        message: `Candidate confidence ${parsed.candidate.confidence.toFixed(2)} was below the ${config.minConfidence.toFixed(2)} threshold.`,
        projectRoot,
        sessionId,
        skillName: parsed.candidate.name,
        toolUseCount: eligibility.toolUseCount,
      })
      return
    }

    const existingSkills = comparableSkills(commands)
    const gate = evaluateSkillCreationCandidate({
      candidate: parsed.candidate,
      existingSkills,
    })
    let action: SkillCandidateAction = 'create'
    let scope = parsed.candidate.scope
    let name = parsed.candidate.name
    let description = parsed.candidate.description
    let whenToUse = parsed.candidate.whenToUse
    let markdown = parsed.candidate.body
    let target: SkillCandidateTarget | undefined

    if (gate.decision !== 'create' && gate.bestMatch) {
      const matchingCommand = existingSkills.find(
        command => command.name === gate.bestMatch?.skillName,
      )
      const writable = writableTarget(matchingCommand)
      if (!writable || !matchingCommand) {
        await recordSkillLearningEvent({
          kind: 'candidate-reused',
          message: `Existing protected Skill /${gate.bestMatch.skillName} already covers this workflow.`,
          projectRoot,
          sessionId,
          skillName: gate.bestMatch.skillName,
          toolUseCount: eligibility.toolUseCount,
        })
        return
      }

      const currentMarkdown = await readFile(
        join(writable.root, 'SKILL.md'),
        'utf-8',
      )
      markdown = await mergeWithExistingSkill({
        command: matchingCommand,
        currentMarkdown,
        proposedMarkdown: markdown,
        reason: parsed.candidate.reason,
        model: context.toolUseContext.options.mainLoopModel,
      })
      action = 'update'
      scope = writable.scope
      name = matchingCommand.name
      description = matchingCommand.description
      whenToUse = matchingCommand.whenToUse || parsed.candidate.whenToUse
      target = writable.target
    }

    const saved = await saveSkillCandidate({
      action,
      scope,
      projectRoot,
      name,
      description,
      whenToUse,
      reason: parsed.candidate.reason,
      evidence: parsed.candidate.evidence,
      confidence: parsed.candidate.confidence,
      markdown,
      sourceSessionId: sessionId,
      sourceFingerprint: eligibility.fingerprint,
      sourceToolUses: eligibility.toolUseCount,
      target,
      duplicate: gate.bestMatch && gate.decision !== 'create'
        ? {
            skillName: gate.bestMatch.skillName,
            score: gate.bestMatch.score,
            decision: gate.decision,
          }
        : undefined,
    })
    if (!saved.created) return

    await recordSkillLearningEvent({
      kind: 'candidate-created',
      message: action === 'update'
        ? `Drafted an update for /${name}.`
        : `Drafted a new Skill /${name}.`,
      projectRoot,
      sessionId,
      candidateId: saved.candidate.id,
      skillName: name,
      toolUseCount: eligibility.toolUseCount,
    })

    const canAutoApprove = shouldAutoApproveSkillCandidate(config, saved.candidate)

    if (canAutoApprove) {
      try {
        await approveSkillCandidate(saved.candidate.id, { automatic: true })
      } catch (error) {
        await updateSkillCandidate(saved.candidate.id, {
          status: 'failed',
          error: errorMessage(error),
        })
        throw error
      }
      context.toolUseContext.appendSystemMessage?.(
        createSystemMessage(
          `Skill Learning saved /${name} from this completed workflow.`,
          'suggestion',
          SKILL_LEARNING_NOTICE_TOOL_USE_ID,
        ),
      )
    } else {
      context.toolUseContext.appendSystemMessage?.(
        createSystemMessage(
          `Skill draft ready for review: /${name}.`,
          'suggestion',
          SKILL_LEARNING_NOTICE_TOOL_USE_ID,
        ),
      )
    }
  } catch (error) {
    reviewedTurns.delete(eligibility.fingerprint)
    await recordSkillLearningEvent({
      kind: 'review-failed',
      message: errorMessage(error),
      projectRoot,
      sessionId,
      toolUseCount: eligibility.toolUseCount,
    }).catch(() => {})
    logForDebugging(
      `[skill-learning] review failed: ${errorMessage(error)}`,
      { level: 'debug' },
    )
  }
}

async function executeSkillLearningReviewImpl(
  context: REPLHookContext,
): Promise<void> {
  if (context.querySource !== 'repl_main_thread' && context.querySource !== 'sdk') {
    return
  }
  if (context.toolUseContext.agentId) return

  const sessionId = getSessionId()
  if (inFlightReviews.has(sessionId)) {
    pendingReviews.set(sessionId, context)
    return
  }

  inFlightReviews.add(sessionId)
  let nextContext: REPLHookContext | undefined = context
  try {
    while (nextContext) {
      await reviewSkillLearningContext(nextContext)
      nextContext = pendingReviews.get(sessionId)
      pendingReviews.delete(sessionId)
    }
  } finally {
    inFlightReviews.delete(sessionId)
  }
}

export async function executeSkillLearningReview(
  context: REPLHookContext,
): Promise<void> {
  const review = executeSkillLearningReviewImpl(context)
  inFlightReviewPromises.add(review)
  try {
    await review
  } finally {
    inFlightReviewPromises.delete(review)
  }
}

export async function drainPendingSkillLearningReviews(
  timeoutMs = 60_000,
): Promise<void> {
  if (inFlightReviewPromises.size === 0) return
  await Promise.race([
    Promise.all(inFlightReviewPromises).catch(() => {}),
    // eslint-disable-next-line no-restricted-syntax -- the timer must not keep the process alive
    new Promise<void>(resolve => setTimeout(resolve, timeoutMs).unref()),
  ])
}

export function resetSkillLearningReviewForTesting(): void {
  reviewedTurns.clear()
  inFlightReviews.clear()
  pendingReviews.clear()
  inFlightReviewPromises.clear()
}
