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
  readSkillMemoryPending,
  writeSkillMemorySummary,
} from './store.js'
import { buildSkillMemoryReviewPrompt } from './reviewer.js'
import { evaluateSkillCreationCandidate } from './gate.js'

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
})
