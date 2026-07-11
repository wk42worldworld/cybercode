import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { getCwdState, setCwdState } from '../../bootstrap/state.js'
import { handleSkillsApi } from '../api/skills.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import { saveSkillCandidate } from '../../skillLearning/store.js'

let tmpHome: string
let originalHome: string | undefined
let originalUserProfile: string | undefined
let originalCyberConfigDir: string | undefined
let originalClaudeConfigDir: string | undefined
let originalCwdState: string

function makeRequest(
  urlStr: string,
  init: RequestInit = {},
): { req: Request; url: URL; segments: string[] } {
  const url = new URL(urlStr, 'http://localhost:3456')
  const req = new Request(url.toString(), { method: 'GET', ...init })
  return {
    req,
    url,
    segments: url.pathname.split('/').filter(Boolean),
  }
}

async function writeSkill(root: string, skillName: string, content: string): Promise<void> {
  const skillDir = path.join(root, skillName)
  await fs.mkdir(skillDir, { recursive: true })
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), content, 'utf-8')
}

describe('Skills API', () => {
  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-skills-test-'))
    originalHome = process.env.HOME
    originalUserProfile = process.env.USERPROFILE
    originalCyberConfigDir = process.env.CYBER_CONFIG_DIR
    originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
    originalCwdState = getCwdState()

    process.env.HOME = tmpHome
    process.env.USERPROFILE = tmpHome
    process.env.CYBER_CONFIG_DIR = path.join(tmpHome, '.cyber')
    delete process.env.CLAUDE_CONFIG_DIR
    resetSettingsCache()
    setCwdState(tmpHome)
  })

  afterEach(async () => {
    if (originalHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
    }

    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE
    } else {
      process.env.USERPROFILE = originalUserProfile
    }

    if (originalCyberConfigDir === undefined) {
      delete process.env.CYBER_CONFIG_DIR
    } else {
      process.env.CYBER_CONFIG_DIR = originalCyberConfigDir
    }

    if (originalClaudeConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir
    }

    setCwdState(originalCwdState)
    resetSettingsCache()
    await fs.rm(tmpHome, { recursive: true, force: true })
  })

  it('lists user and project skills for the requested cwd', async () => {
    const userSkillsRoot = path.join(tmpHome, '.cyber', 'skills')
    const projectRoot = path.join(tmpHome, 'workspace')
    const cwd = path.join(projectRoot, 'packages', 'app')

    await writeSkill(
      userSkillsRoot,
      'user-skill',
      ['---', 'description: User scope', '---', '', '# User skill'].join('\n'),
    )
    await writeSkill(
      path.join(projectRoot, '.cyber', 'skills'),
      'project-skill',
      ['---', 'description: Project scope', '---', '', '# Project skill'].join('\n'),
    )

    const { req, url, segments } = makeRequest(`/api/skills?cwd=${encodeURIComponent(cwd)}`)
    const res = await handleSkillsApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = await res.json() as { skills: Array<{ name: string; source: string }> }
    expect(body.skills).toContainEqual(expect.objectContaining({ name: 'user-skill', source: 'user' }))
    expect(body.skills).toContainEqual(expect.objectContaining({ name: 'project-skill', source: 'project' }))
  })

  it('returns the user skills configuration path', async () => {
    const { req, url, segments } = makeRequest('/api/skills/config')
    const res = await handleSkillsApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = await res.json() as { config: { userSkillsDir: string; displayPath: string } }
    expect(body.config.userSkillsDir).toBe(path.join(tmpHome, '.cyber', 'skills'))
    expect(body.config.displayPath).toBe(path.join(tmpHome, '.cyber', 'skills'))
  })

  it('marks disabled skills and persists enablement updates', async () => {
    const userSkillsRoot = path.join(tmpHome, '.cyber', 'skills')
    await writeSkill(
      userSkillsRoot,
      'alpha',
      ['---', 'description: Alpha scope', '---', '', '# Alpha skill'].join('\n'),
    )

    const disableRequest = makeRequest('/api/skills/enabled', {
      method: 'PATCH',
      body: JSON.stringify({ source: 'user', name: 'alpha', enabled: false }),
    })
    const disableRes = await handleSkillsApi(
      disableRequest.req,
      disableRequest.url,
      disableRequest.segments,
    )

    expect(disableRes.status).toBe(200)
    const disabledBody = await disableRes.json() as { disabledSkills: string[] }
    expect(disabledBody.disabledSkills).toContain('user:alpha')

    const { req, url, segments } = makeRequest('/api/skills')
    const res = await handleSkillsApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = await res.json() as { skills: Array<{ name: string; enabled: boolean }> }
    expect(body.skills).toContainEqual(
      expect.objectContaining({ name: 'alpha', enabled: false }),
    )

    const enableRequest = makeRequest('/api/skills/enabled', {
      method: 'PATCH',
      body: JSON.stringify({ source: 'user', name: 'alpha', enabled: true }),
    })
    const enableRes = await handleSkillsApi(
      enableRequest.req,
      enableRequest.url,
      enableRequest.segments,
    )
    const enabledBody = await enableRes.json() as { disabledSkills: string[] }

    expect(enableRes.status).toBe(200)
    expect(enabledBody.disabledSkills).not.toContain('user:alpha')
  })

  it('resolves project skill details from the nearest project skills directory', async () => {
    const projectRoot = path.join(tmpHome, 'workspace')
    const nestedRoot = path.join(projectRoot, 'packages', 'app')
    const nestedSkillsRoot = path.join(nestedRoot, '.cyber', 'skills')
    const parentSkillsRoot = path.join(projectRoot, '.cyber', 'skills')

    await writeSkill(
      parentSkillsRoot,
      'shared-skill',
      ['---', 'description: Parent version', '---', '', 'parent body'].join('\n'),
    )
    await writeSkill(
      nestedSkillsRoot,
      'shared-skill',
      ['---', 'description: Child version', '---', '', 'child body'].join('\n'),
    )

    const { req, url, segments } = makeRequest(
      `/api/skills/detail?source=project&name=shared-skill&cwd=${encodeURIComponent(nestedRoot)}`,
    )
    const res = await handleSkillsApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = await res.json() as {
      detail: { meta: { description: string }; skillRoot: string; files: Array<{ path: string; body?: string }> }
    }

    expect(body.detail.meta.description).toBe('Child version')
    expect(body.detail.skillRoot).toBe(path.join(nestedSkillsRoot, 'shared-skill'))
    expect(body.detail.files).toContainEqual(
      expect.objectContaining({ path: 'SKILL.md', body: 'child body' }),
    )
  })

  it('reads and updates Skill Learning configuration', async () => {
    const getRequest = makeRequest('/api/skills/learning')
    const getResponse = await handleSkillsApi(
      getRequest.req,
      getRequest.url,
      getRequest.segments,
    )
    expect(getResponse.status).toBe(200)
    const initial = await getResponse.json() as {
      overview: { config: { mode: string }; pendingCandidates: unknown[] }
    }
    expect(initial.overview.config.mode).toBe('auto')
    expect(initial.overview.pendingCandidates).toEqual([])

    const updateRequest = makeRequest('/api/skills/learning', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'auto', minToolUses: 8 }),
    })
    const updateResponse = await handleSkillsApi(
      updateRequest.req,
      updateRequest.url,
      updateRequest.segments,
    )
    expect(updateResponse.status).toBe(200)
    const updated = await updateResponse.json() as {
      config: { mode: string; minToolUses: number }
    }
    expect(updated.config).toMatchObject({ mode: 'auto', minToolUses: 8 })
  })

  it('lists and approves a project Skill draft through the API', async () => {
    const projectRoot = path.join(tmpHome, 'workspace')
    await fs.mkdir(projectRoot, { recursive: true })
    const { candidate } = await saveSkillCandidate({
      action: 'create',
      scope: 'project',
      projectRoot,
      name: 'api-verification',
      description: 'Verify this project consistently',
      whenToUse: 'Use after code changes.',
      reason: 'The workflow was repeated',
      evidence: ['Focused tests passed'],
      confidence: 0.94,
      markdown: [
        '---',
        'name: api-verification',
        'description: "Verify this project consistently"',
        'when_to_use: "Use after code changes."',
        '---',
        '',
        '# API Verification',
        '',
        'Run the focused test and production build.',
        '',
      ].join('\n'),
      sourceSessionId: 'session-api',
      sourceFingerprint: 'api-verification-fingerprint',
      sourceToolUses: 9,
    })

    const listRequest = makeRequest(
      `/api/skills/learning?cwd=${encodeURIComponent(projectRoot)}`,
    )
    const listResponse = await handleSkillsApi(
      listRequest.req,
      listRequest.url,
      listRequest.segments,
    )
    const listed = await listResponse.json() as {
      overview: { pendingCandidates: Array<{ id: string; name: string }> }
    }
    expect(listed.overview.pendingCandidates).toContainEqual(
      expect.objectContaining({ id: candidate.id, name: 'api-verification' }),
    )

    const approveRequest = makeRequest(
      `/api/skills/learning/${candidate.id}/approve`,
      { method: 'POST' },
    )
    const approveResponse = await handleSkillsApi(
      approveRequest.req,
      approveRequest.url,
      approveRequest.segments,
    )
    expect(approveResponse.status).toBe(200)
    const approved = await approveResponse.json() as {
      candidate: { status: string; outputPath: string }
    }
    expect(approved.candidate.status).toBe('approved')
    expect(approved.candidate.outputPath).toBe(
      path.join(
        projectRoot,
        '.cyber',
        'skills',
        'api-verification',
        'SKILL.md',
      ),
    )
    expect(
      await fs.readFile(approved.candidate.outputPath, 'utf-8'),
    ).toContain('# API Verification')
  })

  it('rejects unsafe Skill Learning configuration values', async () => {
    const request = makeRequest('/api/skills/learning', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'reckless' }),
    })
    const response = await handleSkillsApi(request.req, request.url, request.segments)
    expect(response.status).toBe(400)
  })
})
