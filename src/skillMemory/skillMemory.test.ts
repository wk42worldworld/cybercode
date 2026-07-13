import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'crypto'
import { mkdir, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  _resetConfigHomeDirForTesting,
  _setConfigHomeDirHomeForTesting,
} from '../utils/envUtils.js'
import {
  getGlobalSkillMemoryRoot,
  getProjectSkillMemoryRoot,
  getSkillMemoryId,
} from './paths.js'
import {
  appendSkillMemoryPending,
  applySkillMemoryToPromptBlocks,
  recordSkillLifecycleUsage,
  readSkillMemoryStats,
  readSkillMemorySummary,
  readSkillMemoryPending,
  setSkillLifecycleStatus,
  updateSkillMemoryStats,
  writeSkillMemorySummary,
} from './store.js'
import { buildSkillMemoryReviewPrompt } from './reviewer.js'
import { evaluateSkillCreationCandidate } from './gate.js'
import { SkillGateTool } from '../tools/SkillGateTool/SkillGateTool.js'
import {
  evaluateSkillLifecycleStatus,
  runSkillMemoryGovernance,
} from './governance.js'
import { SkillMemoryTool } from '../tools/SkillMemoryTool/SkillMemoryTool.js'

describe('skill lifecycle memory', () => {
  let tmpRoot: string
  let tmpHome: string
  let projectRoot: string
  let originalHome: string | undefined
  let originalUserProfile: string | undefined
  let originalCyberConfigDir: string | undefined
  let originalClaudeConfigDir: string | undefined

  beforeEach(async () => {
    tmpRoot = join(tmpdir(), `cyber-skill-memory-${randomUUID()}`)
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

  test('uses cyber global and project skill-memory roots', () => {
    expect(getGlobalSkillMemoryRoot()).toBe(join(tmpHome, '.cyber', 'skill-memory'))
    expect(getProjectSkillMemoryRoot(projectRoot)).toBe(
      join(projectRoot, '.cyber', 'skill-memory'),
    )
  })

  test('injects learned skill notes only when summaries exist', async () => {
    const ref = {
      skillName: 'frontend-design',
      source: 'projectSettings',
      loadedFrom: 'skills',
      projectRoot,
    }

    const originalBlocks = [{ type: 'text' as const, text: 'Base skill body' }]
    expect(await applySkillMemoryToPromptBlocks({ blocks: originalBlocks, ref })).toEqual(
      originalBlocks,
    )

    await writeSkillMemorySummary(ref, 'project', 'Prefer compact operational UI.')
    const blocks = await applySkillMemoryToPromptBlocks({
      blocks: originalBlocks,
      ref,
    })

    expect(blocks).toHaveLength(2)
    expect(blocks[1]).toMatchObject({
      type: 'text',
    })
    expect((blocks[1] as { text: string }).text).toContain('Learned Skill Notes')
    expect((blocks[1] as { text: string }).text).toContain(
      'Prefer compact operational UI.',
    )
  })

  test('records usage in sidecar and stats files', async () => {
    const ref = {
      skillName: 'verify',
      source: 'userSettings',
      loadedFrom: 'skills',
      projectRoot,
    }

    await recordSkillLifecycleUsage({ ref, scope: 'global' })
    await recordSkillLifecycleUsage({ ref, scope: 'global' })

    const usagePath = join(tmpHome, '.cyber', 'skills', '.usage.json')
    const usage = JSON.parse(await readFile(usagePath, 'utf-8'))
    const skillId = getSkillMemoryId(ref)

    expect(usage.skills[skillId].skillName).toBe('verify')
    expect(usage.skills[skillId].useCount).toBe(2)

    const statsPath = join(
      tmpHome,
      '.cyber',
      'skill-memory',
      skillId,
      'STATS.json',
    )
    const stats = JSON.parse(await readFile(statsPath, 'utf-8'))
    expect(stats.useCount).toBe(2)
    expect(stats.status).toBe('active')
  })

  test('appends pending observations for delayed skill summary review', async () => {
    const ref = {
      skillName: 'commit',
      source: 'projectSettings',
      loadedFrom: 'skills',
      projectRoot,
    }

    await appendSkillMemoryPending(ref, 'project', {
      id: 'p1',
      observedAt: '2026-06-15T00:00:00.000Z',
      trigger: 'invoked',
      sessionId: 'session-1',
      excerpt: 'User: always include verification steps.',
    })

    const pending = await readSkillMemoryPending(ref, 'project')
    expect(pending).toHaveLength(1)
    expect(pending[0]?.excerpt).toContain('verification')
  })

  test('builds a conservative automatic review prompt', () => {
    const prompt = buildSkillMemoryReviewPrompt({
      skillName: 'commit',
      currentSummary: 'Use conventional commits.',
      pending: [
        {
          version: 1,
          id: 'p1',
          skillId: 'commit',
          rawKey: 'projectSettings:commit',
          skillName: 'commit',
          source: 'projectSettings',
          loadedFrom: 'skills',
          observedAt: '2026-06-15T00:00:00.000Z',
          trigger: 'invoked',
          excerpt: 'User: always include verification steps.',
        },
      ],
    })

    expect(prompt).toContain('Do not create a new skill')
    expect(prompt).toContain('<summary>')
    expect(prompt).toContain('always include verification steps')
  })

  test('gates duplicate skill creation candidates', () => {
    expect(
      evaluateSkillCreationCandidate({
        candidate: {
          name: 'frontend-design',
          description: 'Create production grade frontend interfaces',
        },
        existingSkills: [
          {
            name: 'frontend-design',
            description: 'Build production grade frontend interfaces',
          },
        ],
      }).decision,
    ).toBe('reuse')

    expect(
      evaluateSkillCreationCandidate({
        candidate: {
          name: 'frontend-ui-polish',
          description:
            'Improve React UI polish layout quality responsive components',
        },
        existingSkills: [
          {
            name: 'react-ui-quality',
            description:
              'Improve React UI polish layout quality accessible components',
          },
        ],
      }).decision,
    ).toBe('merge')

    expect(
      evaluateSkillCreationCandidate({
        candidate: {
          name: 'database-migration',
          description: 'Plan relational database schema migrations',
        },
        existingSkills: [
          {
            name: 'frontend-design',
            description: 'Create production grade frontend interfaces',
          },
        ],
      }).decision,
    ).toBe('create')
  })

  test('SkillGate tool parses proposed SKILL.md and compares loaded skills', async () => {
    const result = await SkillGateTool.call(
      {
        markdown: `---
name: verify-ui
description: Verify web UI flows with Playwright
when_to_use: Use when checking browser UI behavior after frontend changes.
---

# Verify UI
Run the browser verification flow.
`,
      },
      {
        options: {
          commands: [
            {
              type: 'prompt',
              name: 'verify-ui',
              description: 'Verify web UI flows with Playwright',
              whenToUse:
                'Use when checking browser UI behavior after frontend changes.',
              source: 'projectSettings',
              loadedFrom: 'skills',
              progressMessage: 'verifying UI',
              contentLength: 0,
              async getPromptForCommand() {
                return [{ type: 'text' as const, text: 'Verify UI' }]
              },
            },
          ],
        },
      } as any,
      undefined as any,
      undefined as any,
    )

    expect(result.data.decision).toBe('reuse')
    expect(result.data.bestMatch?.skillName).toBe('verify-ui')

    const toolResult = SkillGateTool.mapToolResultToToolResultBlockParam(
      result.data,
      'skill-gate-1',
    )
    expect(toolResult.type).toBe('tool_result')
    expect(toolResult.tool_use_id).toBe('skill-gate-1')
    expect(JSON.parse(String(toolResult.content))).toMatchObject({
      success: true,
      decision: 'reuse',
      bestMatch: { skillName: 'verify-ui' },
    })
  })

  test('marks low-frequency unused skills archived without deleting files', async () => {
    const now = new Date('2026-06-16T00:00:00.000Z')
    const ref = {
      skillName: 'old-helper',
      source: 'userSettings',
      loadedFrom: 'skills',
      projectRoot,
    }
    await updateSkillMemoryStats(ref, 'global', stats => ({
      ...stats,
      status: 'active',
      useCount: 1,
      firstUsedAt: '2026-01-01T00:00:00.000Z',
      lastUsedAt: '2026-01-01T00:00:00.000Z',
    }))

    expect(evaluateSkillLifecycleStatus(await readSkillMemoryStats(ref, 'global'), now)).toBe(
      'archived',
    )

    const report = await runSkillMemoryGovernance({
      commands: [
        {
          type: 'prompt',
          name: 'old-helper',
          description: 'Old helper workflow',
          source: 'userSettings',
          loadedFrom: 'skills',
          progressMessage: 'old helper',
          contentLength: 0,
          async getPromptForCommand() {
            return [{ type: 'text' as const, text: 'Old helper' }]
          },
        },
      ],
      projectRoot,
      now,
      applyStatus: true,
    })

    expect(report.archivedSkills).toContain('old-helper')
    expect((await readSkillMemoryStats(ref, 'global')).status).toBe('archived')
  })

  test('does not inject archived skill summaries into prompts', async () => {
    const ref = {
      skillName: 'archived-helper',
      source: 'userSettings',
      loadedFrom: 'skills',
      projectRoot,
    }
    await writeSkillMemorySummary(ref, 'global', 'Old learned note.')
    await setSkillLifecycleStatus({ ref, scope: 'global', status: 'archived' })

    const blocks = [{ type: 'text' as const, text: 'Base skill body' }]
    expect(await applySkillMemoryToPromptBlocks({ blocks, ref })).toEqual(blocks)
    expect(
      await readSkillMemorySummary(ref, 'global', { includeArchived: true }),
    ).toMatchObject({ content: 'Old learned note.' })
  })

  test('reports duplicate clusters and safely merges SUMMARY.md notes', async () => {
    const targetRef = {
      skillName: 'frontend-ui-polish',
      source: 'projectSettings',
      loadedFrom: 'skills',
      projectRoot,
    }
    const sourceRef = {
      skillName: 'react-ui-quality',
      source: 'projectSettings',
      loadedFrom: 'skills',
      projectRoot,
    }
    await updateSkillMemoryStats(targetRef, 'project', stats => ({
      ...stats,
      useCount: 5,
      lastUsedAt: '2026-06-01T00:00:00.000Z',
    }))
    await updateSkillMemoryStats(sourceRef, 'project', stats => ({
      ...stats,
      useCount: 1,
      lastUsedAt: '2026-06-01T00:00:00.000Z',
    }))
    await writeSkillMemorySummary(targetRef, 'project', 'Prefer compact UI.')
    await writeSkillMemorySummary(sourceRef, 'project', 'Check responsive states.')

    const commands = [
      {
        type: 'prompt',
        name: 'frontend-ui-polish',
        description:
          'Improve React UI polish layout quality responsive components',
        source: 'projectSettings',
        loadedFrom: 'skills',
        progressMessage: 'frontend polish',
        contentLength: 0,
        async getPromptForCommand() {
          return [{ type: 'text' as const, text: 'Polish UI' }]
        },
      },
      {
        type: 'prompt',
        name: 'react-ui-quality',
        description:
          'Improve React UI polish layout quality accessible components',
        source: 'projectSettings',
        loadedFrom: 'skills',
        progressMessage: 'react quality',
        contentLength: 0,
        async getPromptForCommand() {
          return [{ type: 'text' as const, text: 'Quality UI' }]
        },
      },
    ]

    const report = await runSkillMemoryGovernance({
      commands,
      projectRoot,
      mergeMemory: true,
    })

    expect(report.duplicateClusters).toHaveLength(1)
    expect(report.duplicateClusters[0]?.action).toBe('merge-memory')
    expect(report.mergedMemory[0]).toMatchObject({
      targetSkillName: 'frontend-ui-polish',
      changed: true,
    })
    expect(
      (await readSkillMemorySummary(targetRef, 'project'))?.content,
    ).toContain('From /react-ui-quality')
    expect(report.staleSkills).toContain('react-ui-quality')
    expect((await readSkillMemoryStats(sourceRef, 'project')).status).toBe('stale')
  })

  test('duplicate clusters keep the highest similarity score across transitive matches', async () => {
    const commands = [
      {
        type: 'prompt',
        name: 'frontend-ui-polish',
        description:
          'Improve React UI polish layout quality responsive components',
        source: 'projectSettings',
        loadedFrom: 'skills',
        progressMessage: 'frontend polish',
        contentLength: 0,
        async getPromptForCommand() {
          return [{ type: 'text' as const, text: 'Polish UI' }]
        },
      },
      {
        type: 'prompt',
        name: 'react-ui-quality',
        description:
          'Improve React UI polish layout quality accessible components',
        source: 'projectSettings',
        loadedFrom: 'skills',
        progressMessage: 'react quality',
        contentLength: 0,
        async getPromptForCommand() {
          return [{ type: 'text' as const, text: 'Quality UI' }]
        },
      },
      {
        type: 'prompt',
        name: 'react-ui-quality-copy',
        description:
          'Improve React UI polish layout quality accessible components',
        source: 'projectSettings',
        loadedFrom: 'skills',
        progressMessage: 'react quality copy',
        contentLength: 0,
        async getPromptForCommand() {
          return [{ type: 'text' as const, text: 'Quality UI copy' }]
        },
      },
    ]

    const report = await runSkillMemoryGovernance({
      commands,
      projectRoot,
      applyStatus: false,
    })

    expect(report.duplicateClusters).toHaveLength(1)
    expect(report.duplicateClusters[0]?.score).toBe(1)
    expect(report.duplicateClusters[0]?.action).toBe('reuse')
  })

  test('SkillMemory tool can read and pin a skill memory record', async () => {
    const command = {
      type: 'prompt',
      name: 'pin-me',
      description: 'Pinned skill',
      source: 'userSettings',
      loadedFrom: 'skills',
      progressMessage: 'pinning',
      contentLength: 0,
      async getPromptForCommand() {
        return [{ type: 'text' as const, text: 'Pin me' }]
      },
    }

    const context = {
      options: {
        commands: [command],
      },
    } as any

    const setResult = await SkillMemoryTool.call(
      { action: 'set-status', skillName: 'pin-me', status: 'pinned' },
      context,
      undefined as any,
      undefined as any,
    )
    expect(setResult.data.success).toBe(true)

    const readResult = await SkillMemoryTool.call(
      { action: 'read', skillName: 'pin-me' },
      context,
      undefined as any,
      undefined as any,
    )
    expect(readResult.data.stats.status).toBe('pinned')
  })
})
