import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  listPluginMarketplace,
  setPluginMarketplaceSourcesForTesting,
  type PluginMarketplaceSourceDefinition,
} from '../../plugins/pluginMarketplace.js'
import { handlePluginsApi } from '../api/plugins.js'
import { clearAllCaches } from '../../utils/plugins/cacheUtils.js'
import {
  addMarketplaceSource,
  clearMarketplacesCache,
  loadKnownMarketplacesConfig,
} from '../../utils/plugins/marketplaceManager.js'
import { getInstalledPluginsFilePath } from '../../utils/plugins/installedPluginsManager.js'

let tmpDir: string
let originalConfigDir: string | undefined

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8')
}

function makeRequest(
  method: string,
  urlStr: string,
  body?: Record<string, unknown>,
): { req: Request; url: URL; segments: string[] } {
  const url = new URL(urlStr, 'http://localhost:3456')
  const req = new Request(url.toString(), {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  return { req, url, segments: url.pathname.split('/').filter(Boolean) }
}

async function createSources(): Promise<PluginMarketplaceSourceDefinition[]> {
  const openaiRoot = path.join(tmpDir, 'openai-source')
  const anthropicRoot = path.join(tmpDir, 'anthropic-source')

  await writeJson(path.join(openaiRoot, '.agents/plugins/marketplace.json'), {
    name: 'openai-curated',
    plugins: [
      {
        name: 'portable-tools',
        source: { source: 'local', path: './plugins/portable-tools' },
        category: 'Developer Tools',
        policy: { installation: 'AVAILABLE', products: ['CODEX'] },
      },
      {
        name: 'hosted-connector',
        source: { source: 'local', path: './plugins/hosted-connector' },
        category: 'Productivity',
        policy: { installation: 'AVAILABLE' },
      },
    ],
  })
  await writeJson(path.join(openaiRoot, 'plugins/portable-tools/.codex-plugin/plugin.json'), {
    name: 'portable-tools',
    version: '1.2.0',
    updatedAt: '2026-07-20T08:00:00.000Z',
    downloads: 4200,
    description: 'Portable Codex plugin',
    author: { name: 'OpenAI' },
    skills: './skills/',
    interface: {
      displayName: 'Portable Tools',
      shortDescription: 'Portable skills for code work',
      localizedDescriptions: {
        zh: '用于代码工作的便携技能',
        ja: 'コード作業向けのポータブルスキル',
      },
      category: 'Developer Tools',
      brandColor: '#123456',
      composerIcon: './assets/icon.svg',
      logo: './assets/logo.png',
    },
  })
  await fs.mkdir(path.join(openaiRoot, 'plugins/portable-tools/skills/review'), { recursive: true })
  await fs.writeFile(
    path.join(openaiRoot, 'plugins/portable-tools/skills/review/SKILL.md'),
    '---\nname: review\ndescription: Review code\n---\n',
    'utf-8',
  )
  await writeJson(path.join(openaiRoot, 'plugins/hosted-connector/.codex-plugin/plugin.json'), {
    name: 'hosted-connector',
    version: '1.0.0',
    description: 'Only available through a hosted app connector',
    apps: './.app.json',
  })
  await writeJson(path.join(openaiRoot, 'plugins/hosted-connector/.app.json'), {
    apps: { hosted: { id: 'connector_test' } },
  })

  await writeJson(path.join(anthropicRoot, '.claude-plugin/marketplace.json'), {
    name: 'claude-plugins-official',
    description: 'Anthropic plugins',
    owner: { name: 'Anthropic' },
    plugins: [
      {
        name: 'review-suite',
        source: './plugins/review-suite',
        category: 'development',
      },
    ],
  })
  await writeJson(path.join(anthropicRoot, 'plugins/review-suite/.claude-plugin/plugin.json'), {
    name: 'review-suite',
    version: '2.0.0',
    description: 'Review suite plugin',
    icon: './assets/review-icon.png',
    author: { name: 'Anthropic' },
    skills: './skills/',
  })
  await fs.mkdir(path.join(anthropicRoot, 'plugins/review-suite/skills/review'), { recursive: true })
  await fs.writeFile(
    path.join(anthropicRoot, 'plugins/review-suite/skills/review/SKILL.md'),
    '---\nname: review-suite\ndescription: Review a change\n---\n',
    'utf-8',
  )

  return [
    {
      id: 'openai-test',
      name: 'Codex Test',
      repository: 'https://github.com/openai/plugins.git',
      homepage: 'https://github.com/openai/plugins',
      marketplaceName: 'openai-plugins',
      roots: ['.agents/plugins', 'plugins'],
      format: 'codex',
      localPath: openaiRoot,
    },
    {
      id: 'anthropic-test',
      name: 'Anthropic Test',
      repository: 'https://github.com/anthropics/claude-plugins-official.git',
      homepage: 'https://github.com/anthropics/claude-plugins-official',
      marketplaceName: 'anthropic-plugins',
      roots: ['.claude-plugin', 'plugins'],
      format: 'claude',
      localPath: anthropicRoot,
    },
  ]
}

async function createCodexArchive(): Promise<Uint8Array> {
  const files = {
    'repository/.agents/plugins/marketplace.json': JSON.stringify({
      name: 'archive-market',
      plugins: [{
        name: 'archive-tools',
        source: { source: 'local', path: './plugins/archive-tools' },
        policy: { installation: 'AVAILABLE', products: ['CODEX'] },
      }],
    }),
    'repository/plugins/archive-tools/.codex-plugin/plugin.json': JSON.stringify({
      name: 'archive-tools',
      version: '1.0.0',
      description: 'Archive fallback plugin',
      skills: './skills/',
    }),
    'repository/plugins/archive-tools/skills/review/SKILL.md': [
      '---',
      'name: archive-review',
      'description: Review from archive',
      '---',
      '',
    ].join('\n'),
  }
  return Bun.gzipSync(await new Bun.Archive(files).bytes())
}

describe('Plugin marketplace', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cybercode-plugin-market-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = path.join(tmpDir, 'config')
    setPluginMarketplaceSourcesForTesting(await createSources())
    clearAllCaches()
    clearMarketplacesCache()
  })

  afterEach(async () => {
    setPluginMarketplaceSourcesForTesting(undefined)
    clearAllCaches()
    clearMarketplacesCache()
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('normalizes Codex and Anthropic directories without offering connector-only installs', async () => {
    const catalog = await listPluginMarketplace()

    expect(catalog.sources.map((source) => source.status)).toEqual(['ready', 'ready'])
    expect(catalog.items).toHaveLength(3)
    const portable = catalog.items.find((item) => item.name === 'portable-tools')
    const connector = catalog.items.find((item) => item.name === 'hosted-connector')
    const review = catalog.items.find((item) => item.name === 'review-suite')

    expect(portable?.displayName).toBe('Portable Tools')
    expect(portable?.localizedDescriptions).toEqual({
      zh: '用于代码工作的便携技能',
      ja: 'コード作業向けのポータブルスキル',
    })
    expect(portable?.updatedAt).toBe('2026-07-20T08:00:00.000Z')
    expect(portable?.popularity).toBe(4200)
    expect(portable?.iconUrl).toMatch(
      /raw\.githubusercontent\.com\/openai\/plugins\/.+\/plugins\/portable-tools\/assets\/icon\.svg$/,
    )
    expect(portable?.features).toContain('skills')
    expect(portable?.compatible).toBe(true)
    expect(connector?.compatible).toBe(false)
    expect(review?.version).toBe('2.0.0')
    expect(review?.iconUrl).toMatch(
      /raw\.githubusercontent\.com\/anthropics\/claude-plugins-official\/.+\/plugins\/review-suite\/assets\/review-icon\.png$/,
    )
  })

  it('installs a normalized Codex plugin through the existing plugin runtime', async () => {
    const request = makeRequest('POST', '/api/plugins/marketplace/install', {
      id: 'portable-tools@openai-plugins',
    })
    const response = await handlePluginsApi(request.req, request.url, request.segments)
    const result = await response.json() as { updated: boolean; message: string }

    expect(response.status).toBe(200)
    expect(result.updated).toBe(false)
    expect(result.message).toContain('Successfully installed plugin')

    const catalog = await listPluginMarketplace()
    const installed = catalog.items.find((item) => item.id === 'portable-tools@openai-plugins')
    expect(installed?.installations.some((entry) => entry.scope === 'user')).toBe(true)

    await writeJson(path.join(
      tmpDir,
      'openai-source/plugins/portable-tools/.codex-plugin/plugin.json',
    ), {
      name: 'portable-tools',
      version: '1.3.0',
      description: 'Portable Codex plugin',
      author: { name: 'OpenAI' },
      skills: './skills/',
      interface: {
        displayName: 'Portable Tools',
        shortDescription: 'Portable skills for code work',
        category: 'Developer Tools',
      },
    })

    const updateCatalog = await listPluginMarketplace()
    const updateItem = updateCatalog.items.find((item) => item.id === 'portable-tools@openai-plugins')
    expect(updateItem?.installations[0]?.updateAvailable).toBe(true)

    const updateRequest = makeRequest('POST', '/api/plugins/marketplace/install', {
      id: 'portable-tools@openai-plugins',
    })
    const updateResponse = await handlePluginsApi(
      updateRequest.req,
      updateRequest.url,
      updateRequest.segments,
    )
    const updateResult = await updateResponse.json() as { updated: boolean }
    expect(updateResponse.status).toBe(200)
    expect(updateResult.updated).toBe(true)

    const finalCatalog = await listPluginMarketplace()
    const finalItem = finalCatalog.items.find((item) => item.id === 'portable-tools@openai-plugins')
    expect(finalItem?.installations[0]?.version).toBe('1.3.0')
    expect(finalItem?.installations[0]?.updateAvailable).toBe(false)

    const repeatRequest = makeRequest('POST', '/api/plugins/marketplace/install', {
      id: 'portable-tools@openai-plugins',
    })
    const repeatResponse = await handlePluginsApi(
      repeatRequest.req,
      repeatRequest.url,
      repeatRequest.segments,
    )
    expect(repeatResponse.status).toBe(200)
    expect((await repeatResponse.json() as { updated: boolean }).updated).toBe(false)

    await writeJson(path.join(
      tmpDir,
      'openai-source/plugins/portable-tools/.codex-plugin/plugin.json',
    ), {
      name: 'portable-tools',
      version: '1.1.0',
      description: 'Older portable Codex plugin',
      skills: './skills/',
    })
    const downgradeCatalog = await listPluginMarketplace()
    const downgradeItem = downgradeCatalog.items.find(
      (item) => item.id === 'portable-tools@openai-plugins',
    )
    expect(downgradeItem?.installations[0]?.updateAvailable).toBe(false)

    const downgradeRequest = makeRequest('POST', '/api/plugins/marketplace/install', {
      id: 'portable-tools@openai-plugins',
    })
    const downgradeResponse = await handlePluginsApi(
      downgradeRequest.req,
      downgradeRequest.url,
      downgradeRequest.segments,
    )
    expect((await downgradeResponse.json() as { updated: boolean }).updated).toBe(false)
    const afterDowngradeAttempt = await listPluginMarketplace()
    expect(afterDowngradeAttempt.items.find(
      (item) => item.id === 'portable-tools@openai-plugins',
    )?.installations[0]?.version).toBe('1.3.0')
  }, 30_000)

  it('serializes concurrent installs for the same plugin', async () => {
    const requests = [0, 1].map(() => makeRequest(
      'POST',
      '/api/plugins/marketplace/install',
      { id: 'portable-tools@openai-plugins' },
    ))
    const responses = await Promise.all(requests.map(
      ({ req, url, segments }) => handlePluginsApi(req, url, segments),
    ))

    expect(responses.map((response) => response.status)).toEqual([200, 200])
    const installedFile = JSON.parse(
      await fs.readFile(getInstalledPluginsFilePath(), 'utf-8'),
    ) as { plugins: Record<string, unknown[]> }
    expect(installedFile.plugins['portable-tools@openai-plugins']).toHaveLength(1)
  }, 30_000)

  it('uses the source revision for legacy installations without a version', async () => {
    const request = makeRequest('POST', '/api/plugins/marketplace/install', {
      id: 'portable-tools@openai-plugins',
    })
    const response = await handlePluginsApi(request.req, request.url, request.segments)
    expect(response.status).toBe(200)

    const installedPath = getInstalledPluginsFilePath()
    const installedFile = JSON.parse(await fs.readFile(installedPath, 'utf-8')) as {
      plugins: Record<string, Array<{ version?: string; gitCommitSha?: string }>>
    }
    const installation = installedFile.plugins['portable-tools@openai-plugins']?.[0]
    expect(installation).toBeDefined()
    delete installation!.version
    installation!.gitCommitSha = 'legacy-stale-revision'
    await writeJson(installedPath, installedFile)
    clearAllCaches()

    const catalog = await listPluginMarketplace()
    const item = catalog.items.find((entry) => entry.id === 'portable-tools@openai-plugins')
    expect(item?.installations[0]?.updateAvailable).toBe(true)
  }, 30_000)

  it('does not overwrite a user marketplace with the same name', async () => {
    const userMarketplace = path.join(tmpDir, 'user-openai-marketplace')
    await writeJson(path.join(userMarketplace, '.claude-plugin/marketplace.json'), {
      name: 'openai-plugins',
      owner: { name: 'User' },
      plugins: [],
    })
    await addMarketplaceSource({ source: 'directory', path: userMarketplace })
    const before = await loadKnownMarketplacesConfig()

    const request = makeRequest('POST', '/api/plugins/marketplace/install', {
      id: 'portable-tools@openai-plugins',
    })
    const response = await handlePluginsApi(request.req, request.url, request.segments)
    const after = await loadKnownMarketplacesConfig()

    expect(response.status).toBe(503)
    expect(after['openai-plugins']?.installLocation).toBe(
      before['openai-plugins']?.installLocation,
    )
  }, 30_000)

  it('repairs a corrupt cache through the archive fallback when Git cannot clone', async () => {
    const archive = await createCodexArchive()
    const invalidArchive = Bun.gzipSync(await new Bun.Archive({
      'repository/.agents/plugins/marketplace.json': '[]\n',
      'repository/plugins/placeholder.txt': 'invalid marketplace',
    }).bytes())
    let servedArchive = archive
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response(servedArchive, {
        headers: { 'Content-Type': 'application/gzip' },
      }),
    })
    try {
      const cachePath = path.join(
        process.env.CLAUDE_CONFIG_DIR!,
        'cache/plugin-marketplace/archive-test',
      )
      await fs.mkdir(cachePath, { recursive: true })
      setPluginMarketplaceSourcesForTesting([{
        id: 'archive-test',
        name: 'Archive Test',
        repository: path.join(tmpDir, 'missing-git-repository'),
        archiveUrl: `http://127.0.0.1:${server.port}/plugins.tar.gz`,
        homepage: 'https://example.invalid/plugins',
        marketplaceName: 'archive-plugins',
        roots: ['.agents/plugins', 'plugins'],
        format: 'codex',
      }])

      const catalog = await listPluginMarketplace()
      expect(catalog.sources[0]?.status).toBe('ready')
      expect(catalog.items.map((item) => item.id)).toEqual([
        'archive-tools@archive-plugins',
      ])

      servedArchive = invalidArchive
      const staleCatalog = await listPluginMarketplace({ refresh: true })
      expect(staleCatalog.sources[0]?.status).toBe('stale')
      expect(staleCatalog.items.map((item) => item.id)).toEqual([
        'archive-tools@archive-plugins',
      ])

      const cachedCatalog = await listPluginMarketplace()
      expect(cachedCatalog.sources[0]?.status).toBe('ready')
      expect(cachedCatalog.items.map((item) => item.id)).toEqual([
        'archive-tools@archive-plugins',
      ])
    } finally {
      server.stop(true)
    }
  }, 30_000)

  it('marks malformed marketplace manifests as source errors', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'openai-source/.agents/plugins/marketplace.json'),
      '[]\n',
      'utf-8',
    )
    const catalog = await listPluginMarketplace()
    expect(catalog.sources.find((source) => source.id === 'openai-test')?.status).toBe('error')
  })

  it('rejects a null install request body with 400', async () => {
    const url = new URL('/api/plugins/marketplace/install', 'http://localhost:3456')
    const req = new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    })
    const response = await handlePluginsApi(
      req,
      url,
      url.pathname.split('/').filter(Boolean),
    )
    expect(response.status).toBe(400)
  })

  it('stops an already cancelled marketplace request', async () => {
    const controller = new AbortController()
    controller.abort()
    const url = new URL('/api/plugins/marketplace', 'http://localhost:3456')
    const req = new Request(url, { signal: controller.signal })
    const response = await handlePluginsApi(
      req,
      url,
      url.pathname.split('/').filter(Boolean),
    )
    expect(response.status).toBe(499)
  })
})
