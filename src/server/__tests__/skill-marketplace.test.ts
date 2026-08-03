import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { handleSkillsApi } from '../api/skills.js'
import {
  setSkillMarketplaceSourcesForTesting,
  type SkillMarketplaceCatalog,
} from '../../skills/skillMarketplace.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'

let temporaryRoot: string
let sourceRoot: string
let projectRoot: string
let originalCyberConfigDir: string | undefined
let originalClaudeConfigDir: string | undefined

function makeRequest(urlValue: string, init: RequestInit = {}) {
  const url = new URL(urlValue, 'http://localhost:3456')
  const req = new Request(url.toString(), { method: 'GET', ...init })
  return {
    req,
    url,
    segments: url.pathname.split('/').filter(Boolean),
  }
}

async function writeMarketSkill(
  relativeDirectory: string,
  frontmatter: string[],
  body = '# Test Skill',
): Promise<void> {
  const skillDirectory = path.join(sourceRoot, 'skills', relativeDirectory)
  await fs.mkdir(skillDirectory, { recursive: true })
  await fs.writeFile(
    path.join(skillDirectory, 'SKILL.md'),
    ['---', ...frontmatter, '---', '', body, ''].join('\n'),
    'utf-8',
  )
}

describe('Skill marketplace API', () => {
  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cyber-skill-market-'))
    sourceRoot = path.join(temporaryRoot, 'market-source')
    projectRoot = path.join(temporaryRoot, 'workspace')
    await fs.mkdir(projectRoot, { recursive: true })
    originalCyberConfigDir = process.env.CYBER_CONFIG_DIR
    originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CYBER_CONFIG_DIR = path.join(temporaryRoot, '.cyber')
    delete process.env.CLAUDE_CONFIG_DIR
    resetSettingsCache()
    setSkillMarketplaceSourcesForTesting([
      {
        id: 'test-market',
        name: 'Test Agent Skills',
        repository: sourceRoot,
        homepage: 'https://example.com/test-agent-skills',
        roots: ['skills'],
        localPath: sourceRoot,
      },
    ])
  })

  afterEach(async () => {
    setSkillMarketplaceSourcesForTesting()
    if (originalCyberConfigDir === undefined) delete process.env.CYBER_CONFIG_DIR
    else process.env.CYBER_CONFIG_DIR = originalCyberConfigDir
    if (originalClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir
    resetSettingsCache()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('discovers standard and categorized SKILL.md packages', async () => {
    await writeMarketSkill('alpha', [
      'name: alpha',
      'description: Alpha workflow',
      'description_zh: Alpha 工作流',
      'version: 1.2.0',
      'updatedAt: "2026-07-21T08:00:00.000Z"',
      'popularity: 1250',
      'license: MIT',
    ])
    await writeMarketSkill('research/deep-search', [
      'name: deep-search',
      'description: Search multiple sources',
      'tags: [research, search]',
    ])
    await writeMarketSkill('hidden', [
      'name: hidden',
      'description: Hidden workflow',
      'metadata:',
      '  internal: true',
    ])

    const request = makeRequest(
      `/api/skills/marketplace?cwd=${encodeURIComponent(projectRoot)}`,
    )
    const response = await handleSkillsApi(
      request.req,
      request.url,
      request.segments,
    )

    expect(response.status).toBe(200)
    const body = await response.json() as { catalog: SkillMarketplaceCatalog }
    expect(body.catalog.sources).toContainEqual(expect.objectContaining({
      id: 'test-market',
      status: 'ready',
      itemCount: 2,
    }))
    expect(body.catalog.items).toContainEqual(expect.objectContaining({
      id: 'test-market:skills/alpha',
      displayName: 'alpha',
      description: 'Alpha workflow',
      localizedDescriptions: { zh: 'Alpha 工作流' },
      version: '1.2.0',
      updatedAt: '2026-07-21T08:00:00.000Z',
      popularity: 1250,
      category: 'general',
    }))
    expect(body.catalog.items).toContainEqual(expect.objectContaining({
      id: 'test-market:skills/research/deep-search',
      category: 'research',
      tags: ['research', 'search'],
    }))
    expect(body.catalog.items.some((item) => item.name === 'hidden')).toBe(false)
  })

  it('installs and safely uninstalls a marketplace Skill in project scope', async () => {
    await writeMarketSkill('release-check', [
      'name: release-check',
      'description: Verify release artifacts',
    ], '# Release Check\n\nRun the verification suite.')

    const installRequest = makeRequest('/api/skills/marketplace/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemId: 'test-market:skills/release-check',
        scope: 'project',
        cwd: projectRoot,
      }),
    })
    const installResponse = await handleSkillsApi(
      installRequest.req,
      installRequest.url,
      installRequest.segments,
    )

    expect(installResponse.status).toBe(200)
    const installedPath = path.join(
      projectRoot,
      '.cyber',
      'skills',
      'release-check',
    )
    expect(await fs.readFile(path.join(installedPath, 'SKILL.md'), 'utf-8'))
      .toContain('Run the verification suite.')
    const metadata = JSON.parse(
      await fs.readFile(path.join(installedPath, '.cybercode-market.json'), 'utf-8'),
    ) as { itemId: string; sourceId: string }
    expect(metadata).toMatchObject({
      itemId: 'test-market:skills/release-check',
      sourceId: 'test-market',
    })

    const listRequest = makeRequest(
      `/api/skills/marketplace?cwd=${encodeURIComponent(projectRoot)}`,
    )
    const listResponse = await handleSkillsApi(
      listRequest.req,
      listRequest.url,
      listRequest.segments,
    )
    const listed = await listResponse.json() as { catalog: SkillMarketplaceCatalog }
    expect(listed.catalog.items[0]?.installations).toContainEqual({
      scope: 'project',
      managed: true,
      updateAvailable: false,
    })

    const future = new Date(Date.now() + 60_000)
    await fs.utimes(sourceRoot, future, future)
    const updateStateRequest = makeRequest(
      `/api/skills/marketplace?cwd=${encodeURIComponent(projectRoot)}`,
    )
    const updateStateResponse = await handleSkillsApi(
      updateStateRequest.req,
      updateStateRequest.url,
      updateStateRequest.segments,
    )
    const updateState = await updateStateResponse.json() as {
      catalog: SkillMarketplaceCatalog
    }
    expect(updateState.catalog.items[0]?.installations).toContainEqual({
      scope: 'project',
      managed: true,
      updateAvailable: true,
    })

    const updateRequest = makeRequest('/api/skills/marketplace/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemId: 'test-market:skills/release-check',
        scope: 'project',
        cwd: projectRoot,
      }),
    })
    const updateResponse = await handleSkillsApi(
      updateRequest.req,
      updateRequest.url,
      updateRequest.segments,
    )
    expect(updateResponse.status).toBe(200)
    expect(await updateResponse.json()).toMatchObject({ updated: true })

    const uninstallRequest = makeRequest('/api/skills/marketplace/uninstall', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemId: 'test-market:skills/release-check',
        scope: 'project',
        cwd: projectRoot,
      }),
    })
    const uninstallResponse = await handleSkillsApi(
      uninstallRequest.req,
      uninstallRequest.url,
      uninstallRequest.segments,
    )
    expect(uninstallResponse.status).toBe(200)
    await expect(fs.stat(installedPath)).rejects.toThrow()
  })

  it('does not overwrite an existing unmanaged Skill with the same name', async () => {
    await writeMarketSkill('alpha', [
      'name: alpha',
      'description: Marketplace Alpha',
    ])
    const existingPath = path.join(
      temporaryRoot,
      '.cyber',
      'skills',
      'alpha',
    )
    await fs.mkdir(existingPath, { recursive: true })
    await fs.writeFile(
      path.join(existingPath, 'SKILL.md'),
      '# My existing Alpha\n',
      'utf-8',
    )

    const request = makeRequest('/api/skills/marketplace/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemId: 'test-market:skills/alpha',
        scope: 'user',
      }),
    })
    const response = await handleSkillsApi(request.req, request.url, request.segments)

    expect(response.status).toBe(409)
    expect(await fs.readFile(path.join(existingPath, 'SKILL.md'), 'utf-8'))
      .toBe('# My existing Alpha\n')
  })
})
