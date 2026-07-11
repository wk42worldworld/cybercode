import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  _resetConfigHomeDirForTesting,
  _setConfigHomeDirHomeForTesting,
} from '../utils/envUtils.js'
import { approveSkillCandidate, rejectSkillCandidate } from './approval.js'
import {
  evaluateSkillReviewEligibility,
  parseSkillCandidateResponse,
  shouldAutoApproveSkillCandidate,
} from './reviewer.js'
import {
  getSkillCandidate,
  readSkillLearningConfig,
  readSkillLearningState,
  saveSkillCandidate,
  updateSkillLearningConfig,
} from './store.js'
import { DEFAULT_SKILL_LEARNING_CONFIG } from './types.js'
import type { Message } from '../types/message.js'

function buildSkillMarkdown(name: string, body = 'Follow the verified steps.'): string {
  return [
    '---',
    `name: ${name}`,
    'description: "Reusable project verification workflow"',
    'when_to_use: "Use when verifying this project after a change."',
    'user-invocable: true',
    '---',
    '',
    '# Verification Workflow',
    '',
    body,
    '',
  ].join('\n')
}

function taskMessages(toolUseCount: number, userText = 'Implement and verify the fix.'): Message[] {
  return [
    {
      type: 'user',
      message: { role: 'user', content: userText },
      uuid: 'user-1',
      timestamp: new Date().toISOString(),
    } as Message,
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: Array.from({ length: toolUseCount }, (_, index) => ({
          type: 'tool_use',
          id: `tool-${index}`,
          name: index % 2 === 0 ? 'Read' : 'Edit',
          input: { path: `src/file-${index}.ts` },
        })),
      },
      uuid: 'assistant-1',
      timestamp: new Date().toISOString(),
    } as Message,
  ]
}

describe('Skill Learning', () => {
  let tmpRoot: string
  let tmpHome: string
  let projectRoot: string
  let originalHome: string | undefined
  let originalUserProfile: string | undefined
  let originalCyberConfigDir: string | undefined
  let originalClaudeConfigDir: string | undefined

  beforeEach(async () => {
    tmpRoot = join(tmpdir(), `cyber-skill-learning-${crypto.randomUUID()}`)
    tmpHome = join(tmpRoot, 'home')
    projectRoot = join(tmpRoot, 'project')
    await mkdir(tmpHome, { recursive: true })
    await mkdir(projectRoot, { recursive: true })

    originalHome = process.env.HOME
    originalUserProfile = process.env.USERPROFILE
    originalCyberConfigDir = process.env.CYBER_CONFIG_DIR
    originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR

    process.env.HOME = tmpHome
    process.env.USERPROFILE = tmpHome
    delete process.env.CYBER_CONFIG_DIR
    delete process.env.CLAUDE_CONFIG_DIR
    _setConfigHomeDirHomeForTesting(tmpHome)
  })

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    if (originalUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = originalUserProfile
    if (originalCyberConfigDir === undefined) delete process.env.CYBER_CONFIG_DIR
    else process.env.CYBER_CONFIG_DIR = originalCyberConfigDir
    if (originalClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir

    _setConfigHomeDirHomeForTesting(undefined)
    _resetConfigHomeDirForTesting()
    await rm(tmpRoot, { recursive: true, force: true })
  })

  test('defaults to auto mode and persists mode changes', async () => {
    expect(await readSkillLearningConfig()).toEqual(
      DEFAULT_SKILL_LEARNING_CONFIG,
    )

    const updated = await updateSkillLearningConfig({ mode: 'suggest' })
    expect(updated.mode).toBe('suggest')
    expect((await readSkillLearningConfig()).mode).toBe('suggest')
  })

  test('auto mode approves every candidate that passed the quality gate', () => {
    const variants = [
      { action: 'create' as const, scope: 'project' as const, confidence: 0.79 },
      { action: 'update' as const, scope: 'project' as const, confidence: 0.81 },
      { action: 'create' as const, scope: 'global' as const, confidence: 0.83 },
      {
        action: 'update' as const,
        scope: 'global' as const,
        confidence: 0.8,
        duplicate: { skillName: 'existing', score: 0.9, decision: 'merge' as const },
      },
    ]

    for (const candidate of variants) {
      expect(shouldAutoApproveSkillCandidate(DEFAULT_SKILL_LEARNING_CONFIG, candidate)).toBe(true)
      expect(shouldAutoApproveSkillCandidate(
        { ...DEFAULT_SKILL_LEARNING_CONFIG, mode: 'suggest' },
        candidate,
      )).toBe(false)
    }
  })

  test('reviews complex tasks and ignores trivial turns', () => {
    const simple = evaluateSkillReviewEligibility(
      taskMessages(1),
      DEFAULT_SKILL_LEARNING_CONFIG,
      { sessionId: 'session-1', projectRoot },
    )
    expect(simple.eligible).toBe(false)
    expect(simple.toolUseCount).toBe(1)

    const complex = evaluateSkillReviewEligibility(
      taskMessages(6),
      DEFAULT_SKILL_LEARNING_CONFIG,
      { sessionId: 'session-1', projectRoot },
    )
    expect(complex.eligible).toBe(true)
    expect(complex.reason).toContain('tool-use learning threshold')
  })

  test('uses repeated user correction as a lower review threshold', () => {
    const result = evaluateSkillReviewEligibility(
      taskMessages(3, '不要这样做，必须在每次修改后先运行验证。'),
      DEFAULT_SKILL_LEARNING_CONFIG,
      { sessionId: 'session-2', projectRoot },
    )

    expect(result.eligible).toBe(true)
    expect(result.correctionSignal).toBe(true)
  })

  test('redacts credentials before a task reaches the review model', () => {
    const secret = `ghp_${'a'.repeat(36)}`
    const result = evaluateSkillReviewEligibility(
      taskMessages(6, `Use ${secret} while testing.`),
      DEFAULT_SKILL_LEARNING_CONFIG,
      { sessionId: 'session-secret', projectRoot },
    )

    expect(result.excerpt).not.toContain(secret)
    expect(result.excerpt).toContain('[REDACTED]')
  })

  test('parses a structured model response into a complete SKILL.md draft', () => {
    const parsed = parseSkillCandidateResponse(
      [
        '<candidate>{"name":"project-verification","description":"Verify project changes consistently","whenToUse":"Use when completing a code change in this project.","scope":"project","reason":"The workflow was repeated and verified","confidence":0.94,"evidence":["Tests and build both passed"]}</candidate>',
        '<skill_body># Project Verification\n\n## Steps\n\n1. Run the focused tests.\n2. Run the production build.\n\n## Verification\n\nBoth commands must exit successfully.</skill_body>',
      ].join('\n'),
      { sessionId: 'session-3' },
    )

    expect(parsed.candidate?.name).toBe('project-verification')
    expect(parsed.candidate?.body).toContain('name: project-verification')
    expect(parsed.candidate?.body).toContain('created_by: skill-learning')
    expect(parsed.candidate?.body).toContain('source_session: "session-3"')
  })

  test('deduplicates a candidate from the same completed task', async () => {
    const input = {
      action: 'create' as const,
      scope: 'project' as const,
      projectRoot,
      name: 'project-verification',
      description: 'Reusable project verification workflow',
      whenToUse: 'Use after changing this project.',
      reason: 'Repeated workflow',
      evidence: ['Tests passed'],
      confidence: 0.93,
      markdown: buildSkillMarkdown('project-verification'),
      sourceSessionId: 'session-4',
      sourceFingerprint: 'same-task-fingerprint',
      sourceToolUses: 8,
    }

    const first = await saveSkillCandidate(input)
    const second = await saveSkillCandidate(input)
    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.candidate.id).toBe(first.candidate.id)
    expect((await readSkillLearningState()).candidates).toHaveLength(1)
  })

  test('approves a project draft by writing SKILL.md and recording its state', async () => {
    const { candidate } = await saveSkillCandidate({
      action: 'create',
      scope: 'project',
      projectRoot,
      name: 'project-verification',
      description: 'Reusable project verification workflow',
      whenToUse: 'Use after changing this project.',
      reason: 'Repeated workflow',
      evidence: ['Tests passed'],
      confidence: 0.93,
      markdown: buildSkillMarkdown('project-verification'),
      sourceSessionId: 'session-5',
      sourceFingerprint: 'approval-fingerprint',
      sourceToolUses: 8,
    })

    const approved = await approveSkillCandidate(candidate.id)
    const skillPath = join(
      projectRoot,
      '.cyber',
      'skills',
      'project-verification',
      'SKILL.md',
    )
    expect(approved.status).toBe('approved')
    expect(approved.outputPath).toBe(skillPath)
    expect(await readFile(skillPath, 'utf-8')).toContain('# Verification Workflow')
    expect((await stat(skillPath)).mode & 0o777).toBe(0o600)
    expect((await getSkillCandidate(candidate.id))?.status).toBe('approved')
  })

  test('backs up an existing Skill before approving an update', async () => {
    const skillRoot = join(projectRoot, '.cyber', 'skills', 'existing-skill')
    await mkdir(skillRoot, { recursive: true })
    await writeFile(
      join(skillRoot, 'SKILL.md'),
      buildSkillMarkdown('existing-skill', 'Original instructions.'),
    )
    const { candidate } = await saveSkillCandidate({
      action: 'update',
      scope: 'project',
      projectRoot,
      name: 'existing-skill',
      description: 'Updated workflow',
      whenToUse: 'Use this existing workflow.',
      reason: 'New durable lesson',
      evidence: ['Correction repeated'],
      confidence: 0.91,
      markdown: buildSkillMarkdown('existing-skill', 'Updated instructions.'),
      sourceSessionId: 'session-6',
      sourceFingerprint: 'update-fingerprint',
      sourceToolUses: 7,
      target: { skillName: 'existing-skill', source: 'project' },
    })

    await approveSkillCandidate(candidate.id)

    expect(await readFile(join(skillRoot, 'SKILL.md'), 'utf-8')).toContain(
      'Updated instructions.',
    )
    expect(
      await readFile(
        join(
          tmpHome,
          '.cyber',
          'skill-learning',
          'backups',
          candidate.id,
          'SKILL.md',
        ),
        'utf-8',
      ),
    ).toContain('Original instructions.')
  })

  test('blocks credentials from being written and allows rejecting the draft', async () => {
    const secret = `ghp_${'b'.repeat(36)}`
    const { candidate } = await saveSkillCandidate({
      action: 'create',
      scope: 'project',
      projectRoot,
      name: 'unsafe-skill',
      description: 'Unsafe workflow',
      whenToUse: 'Never',
      reason: 'Test secret safety',
      evidence: [],
      confidence: 0.99,
      markdown: buildSkillMarkdown('unsafe-skill', `Use ${secret}.`),
      sourceSessionId: 'session-7',
      sourceFingerprint: 'secret-fingerprint',
      sourceToolUses: 6,
    })

    await expect(approveSkillCandidate(candidate.id)).rejects.toThrow(
      'possible credentials',
    )
    const rejected = await rejectSkillCandidate(candidate.id)
    expect(rejected.status).toBe('rejected')
  })
})
