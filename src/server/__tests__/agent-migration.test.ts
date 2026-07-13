import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { pathToFileURL } from 'url'
import { handleAgentMigrationApi } from '../api/agent-migration.js'
import {
  AgentMigrationService,
  type AgentMigrationRequest,
} from '../services/agentMigrationService.js'

describe('AgentMigrationService', () => {
  let root: string
  let homeDir: string
  let cyberConfigDir: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cyber-agent-migration-'))
    homeDir = join(root, 'home')
    cyberConfigDir = join(homeDir, '.cyber')
    await mkdir(homeDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('detects compatible skills, memories, instructions, and project paths', async () => {
    const projectPath = join(root, 'workspace', 'app')
    await mkdir(projectPath, { recursive: true })
    await write(join(homeDir, '.claude', 'skills', 'review', 'SKILL.md'), [
      '---',
      'name: review',
      'description: Review code',
      '---',
      '# Review',
    ].join('\n'))
    await write(join(homeDir, '.claude', 'CLAUDE.md'), '# Global Claude rules')
    await write(
      join(homeDir, '.claude', 'projects', projectPath.replace(/[^a-zA-Z0-9]/g, '-'), 'session.jsonl'),
      JSON.stringify({ type: 'user', cwd: projectPath }),
    )
    await write(
      join(homeDir, '.claude', 'projects', projectPath.replace(/[^a-zA-Z0-9]/g, '-'), 'memory', 'MEMORY.md'),
      '# Project memory\nUse Bun.',
    )
    await write(join(projectPath, 'CLAUDE.md'), '# Project rules')

    await write(join(homeDir, '.openclaw', 'workspace', 'MEMORY.md'), '# OpenClaw memory')
    await write(join(homeDir, '.openclaw', 'workspace', 'AGENTS.md'), '# OpenClaw rules')
    await write(join(homeDir, '.hermes', 'memories', 'MEMORY.md'), '# Hermes memory')
    await write(join(homeDir, '.codewhale', 'skills', 'ship', 'SKILL.md'), '# Ship skill')
    await write(join(homeDir, '.cursor', 'skills', 'cursor-review', 'SKILL.md'), '# Cursor review')
    await write(join(projectPath, '.cursor', 'skills', 'cursor-project', 'SKILL.md'), '# Cursor project skill')
    await write(join(projectPath, '.cursor', 'rules', 'frontend.mdc'), '# Cursor frontend rule')
    await write(join(projectPath, 'backend', '.cursor', 'rules', 'backend.mdc'), '# Cursor nested rule')
    await write(join(projectPath, '.cursorrules'), '# Legacy Cursor rule')
    await write(
      join(homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'workspaceStorage', 'workspace-1', 'workspace.json'),
      JSON.stringify({ folder: pathToFileURL(projectPath).href }),
    )

    const service = createService({
      findExecutable: command => command === 'claude' ? '/bin/claude' : null,
    })
    const scan = await service.scan()

    const claude = scan.agents.find(agent => agent.id === 'claude-code')!
    expect(claude.installed).toBe(true)
    expect(claude.counts.skills).toBe(1)
    expect(claude.counts.memories).toBe(1)
    expect(claude.counts.instructions).toBe(2)
    expect(claude.projects).toContainEqual(expect.objectContaining({ path: await realpath(projectPath), exists: true }))

    const openClaw = scan.agents.find(agent => agent.id === 'openclaw')!
    expect(openClaw.counts.memories).toBe(1)
    expect(openClaw.counts.instructions).toBeGreaterThanOrEqual(1)

    expect(scan.agents.find(agent => agent.id === 'hermes-agent')?.counts.memories).toBe(1)
    expect(scan.agents.find(agent => agent.id === 'deepseek-tui')?.counts.skills).toBe(1)

    const cursor = scan.agents.find(agent => agent.id === 'cursor')!
    expect(cursor.installed).toBe(true)
    expect(cursor.counts.skills).toBe(2)
    expect(cursor.counts.instructions).toBe(4)
    expect(cursor.projects).toContainEqual(expect.objectContaining({ path: await realpath(projectPath), exists: true }))
  })

  it('migrates selected items and preserves an existing CyberCode skill', async () => {
    const projectPath = join(root, 'workspace', 'codex-app')
    await mkdir(projectPath, { recursive: true })
    await write(join(homeDir, '.codex', 'skills', 'review', 'SKILL.md'), '# Imported review')
    await write(join(homeDir, '.codex', 'AGENTS.md'), '# Global Codex rules')
    await write(
      join(homeDir, '.codex', 'sessions', '2026', '07', '13', 'session.jsonl'),
      JSON.stringify({ type: 'session_meta', payload: { cwd: projectPath } }),
    )
    await write(join(projectPath, 'AGENTS.md'), '# Project Codex rules')
    await write(join(projectPath, '.agents', 'skills', 'project-review', 'SKILL.md'), '# Project review')
    await write(join(cyberConfigDir, 'skills', 'review', 'SKILL.md'), '# Existing CyberCode review')

    const registered: string[] = []
    let refreshed = 0
    const service = createService({
      findExecutable: command => command === 'codex' ? '/bin/codex' : null,
      registerProject: async project => {
        registered.push(project)
        return true
      },
      refreshSearchIndex: async () => { refreshed += 1 },
    })
    const scan = await service.scan()
    const codex = scan.agents.find(agent => agent.id === 'codex')!
    const globalSkill = codex.items.find(item => item.kind === 'skill' && item.scope === 'global')!
    const globalInstruction = codex.items.find(item => item.kind === 'instruction' && item.scope === 'global')!
    const canonicalProjectPath = await realpath(projectPath)
    const project = codex.projects.find(candidate => candidate.path === canonicalProjectPath)!

    const result = await service.migrate({
      agentId: 'codex',
      itemIds: [globalSkill.id, globalInstruction.id],
      projectIds: [project.id],
    })

    expect(result.failed).toBe(0)
    expect(result.imported).toBe(4)
    expect(registered).toEqual([canonicalProjectPath])
    expect(refreshed).toBe(1)
    expect(await readFile(join(cyberConfigDir, 'skills', 'review', 'SKILL.md'), 'utf-8'))
      .toBe('# Existing CyberCode review')
    const importedSkillPath = result.items.find(item =>
      item.destinationPath?.includes('review-from-codex-'))!.destinationPath!
    expect(await readFile(join(importedSkillPath, 'SKILL.md'), 'utf-8'))
      .toContain('description: "Imported review skill from codex."')
    expect(await readFile(join(cyberConfigDir, 'CYBER.md'), 'utf-8'))
      .toContain('cybercode-import:')

    const projectRule = result.items.find(item => item.destinationPath?.includes('/rules/imports/codex/'))
    expect(projectRule?.status).toBe('imported')
    expect(await readFile(projectRule!.destinationPath!, 'utf-8')).toContain('# Project Codex rules')
    expect(await readFile(join(projectPath, '.cyber', 'skills', 'project-review', 'SKILL.md'), 'utf-8'))
      .toContain('description: "Imported project-review skill from codex."')
  })

  it('stores imported memory in CyberCode project memory without changing prompt memory files', async () => {
    const memoryPath = join(homeDir, '.openclaw', 'workspace', 'MEMORY.md')
    await write(memoryPath, '# Durable memory\nPrefer TypeScript.')
    const service = createService()
    const scan = await service.scan()
    const openClaw = scan.agents.find(agent => agent.id === 'openclaw')!
    const memory = openClaw.items.find(item => item.kind === 'memory' && item.name === 'MEMORY.md')!

    const result = await service.migrate({ agentId: 'openclaw', itemIds: [memory.id] })

    expect(result).toMatchObject({ imported: 1, failed: 0 })
    const destination = result.items[0]!.destinationPath!
    expect(destination).toContain(join('.cyber', 'projects'))
    expect(destination).toContain(join('memory', 'imports', 'openclaw'))
    expect(await readFile(destination, 'utf-8')).toContain('Prefer TypeScript.')
    await expect(readFile(join(cyberConfigDir, 'prompt-memory', 'USER.md'), 'utf-8')).rejects.toThrow()
  })

  it('updates an existing imported file without relying on rename-overwrite behavior', async () => {
    const memoryPath = join(homeDir, '.openclaw', 'workspace', 'MEMORY.md')
    await write(memoryPath, '# Memory\nFirst version.')
    const service = createService()
    const firstScan = await service.scan()
    const firstMemory = firstScan.agents
      .find(agent => agent.id === 'openclaw')!
      .items.find(item => item.kind === 'memory' && item.name === 'MEMORY.md')!
    const firstResult = await service.migrate({ agentId: 'openclaw', itemIds: [firstMemory.id] })
    const destinationPath = firstResult.items[0]!.destinationPath!

    await writeFile(memoryPath, '# Memory\nSecond version.', 'utf-8')
    const secondScan = await service.scan()
    const secondMemory = secondScan.agents
      .find(agent => agent.id === 'openclaw')!
      .items.find(item => item.kind === 'memory' && item.name === 'MEMORY.md')!
    const secondResult = await service.migrate({ agentId: 'openclaw', itemIds: [secondMemory.id] })

    expect(secondResult).toMatchObject({ imported: 1, failed: 0 })
    expect(await readFile(destinationPath, 'utf-8')).toContain('Second version.')
  })

  it('migrates Cursor skills, MDC rules, legacy rules, and project registration', async () => {
    const projectPath = join(root, 'workspace', 'cursor-app')
    await mkdir(projectPath, { recursive: true })
    await write(join(projectPath, '.cursor', 'skills', 'cursor-build', 'SKILL.md'), '# Cursor build skill')
    await write(join(projectPath, '.cursor', 'rules', 'root.mdc'), '# Root Cursor rule')
    await write(join(projectPath, 'packages', 'api', '.cursor', 'rules', 'api.mdc'), '# Nested Cursor rule')
    await write(join(projectPath, '.cursorrules'), '# Legacy Cursor rule')
    await write(
      join(homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'workspaceStorage', 'workspace-2', 'workspace.json'),
      JSON.stringify({ folder: pathToFileURL(projectPath).href }),
    )

    const registered: string[] = []
    const service = createService({
      findExecutable: command => command === 'cursor' ? '/bin/cursor' : null,
      registerProject: async project => {
        registered.push(project)
        return true
      },
    })
    const scan = await service.scan()
    const cursor = scan.agents.find(agent => agent.id === 'cursor')!
    const canonicalProjectPath = await realpath(projectPath)
    const project = cursor.projects.find(candidate => candidate.path === canonicalProjectPath)!

    const result = await service.migrate({ agentId: 'cursor', projectIds: [project.id] })

    expect(result).toMatchObject({ imported: 4, failed: 0 })
    expect(registered).toEqual([canonicalProjectPath])
    expect(await readFile(join(projectPath, '.cyber', 'skills', 'cursor-build', 'SKILL.md'), 'utf-8'))
      .toContain('Cursor build skill')
    const importedRules = result.items.filter(item => item.destinationPath?.includes(join('rules', 'imports', 'cursor')))
    expect(importedRules).toHaveLength(3)
    expect(await Promise.all(importedRules.map(item => readFile(item.destinationPath!, 'utf-8'))))
      .toEqual(expect.arrayContaining([
        expect.stringContaining('Root Cursor rule'),
        expect.stringContaining('Nested Cursor rule'),
        expect.stringContaining('Legacy Cursor rule'),
      ]))
  })

  it('uses CyberCode as a source and converts its data for another agent', async () => {
    await write(join(cyberConfigDir, 'skills', 'review', 'SKILL.md'), '# CyberCode review skill')
    await write(join(cyberConfigDir, 'CYBER.md'), '# CyberCode global rules')
    await write(join(cyberConfigDir, 'prompt-memory', 'USER.md'), '# Preferences\nPrefer Bun.')
    await write(
      join(cyberConfigDir, 'projects', homeDir.replace(/[^a-zA-Z0-9]/g, '-'), 'session.jsonl'),
      JSON.stringify({ type: 'session_meta', payload: { cwd: homeDir } }),
    )

    let refreshed = 0
    const service = createService({
      findExecutable: command => command === 'codex' ? '/bin/codex' : null,
      refreshSearchIndex: async () => { refreshed += 1 },
    })
    const scan = await service.scan('codex')
    expect(scan.targetAgentId).toBe('codex')
    const cybercode = scan.agents.find(agent => agent.id === 'cybercode')!
    expect(cybercode.items.filter(item => item.kind === 'skill' && item.name === 'review')).toHaveLength(1)
    const selected = cybercode.items.filter(item =>
      item.kind === 'skill' || item.name === 'CYBER.md' || item.name === 'USER.md')

    expect(selected).toHaveLength(3)
    expect(selected.every(item =>
      item.destinationPath.includes(join(homeDir, '.codex'))
      || item.destinationPath.includes(join(homeDir, '.agents')))).toBe(true)

    const request: AgentMigrationRequest = {
      agentId: 'cybercode',
      targetAgentId: 'codex',
      itemIds: selected.map(item => item.id),
    }
    const result = await service.migrate(request)

    expect(result).toMatchObject({ imported: 3, failed: 0 })
    expect(refreshed).toBe(0)
    expect(await readFile(join(homeDir, '.agents', 'skills', 'review', 'SKILL.md'), 'utf-8'))
      .toContain('CyberCode review skill')
    const codexRules = await readFile(join(homeDir, '.codex', 'AGENTS.md'), 'utf-8')
    expect(codexRules).toContain('CyberCode global rules')
    const memoryResult = result.items.find(item => item.destinationPath?.endsWith('SKILL.md')
      && item.destinationPath.includes('imported-memory'))!
    const codexMemorySkill = await readFile(memoryResult.destinationPath!, 'utf-8')
    expect(codexMemorySkill).toContain('Prefer Bun.')
    expect(codexMemorySkill).toContain('description:')

    const repeated = await service.migrate(request)
    expect(repeated).toMatchObject({ imported: 0, skipped: 3, failed: 0 })
  })

  it('migrates project-scoped data to another agent without fabricating project history', async () => {
    const projectPath = join(root, 'workspace', 'shared-app')
    await mkdir(projectPath, { recursive: true })
    await write(join(projectPath, '.cursor', 'rules', 'frontend.mdc'), '# Cursor project rule')
    await write(
      join(homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'workspaceStorage', 'workspace-3', 'workspace.json'),
      JSON.stringify({ folder: pathToFileURL(projectPath).href }),
    )

    const registered: string[] = []
    const service = createService({
      findExecutable: command => ['cursor', 'claude'].includes(command) ? `/bin/${command}` : null,
      registerProject: async project => {
        registered.push(project)
        return true
      },
    })
    const scan = await service.scan('claude-code')
    const cursor = scan.agents.find(agent => agent.id === 'cursor')!
    const canonicalProjectPath = await realpath(projectPath)
    const project = cursor.projects.find(candidate => candidate.path === canonicalProjectPath)!

    const result = await service.migrate({
      agentId: 'cursor',
      targetAgentId: 'claude-code',
      projectIds: [project.id],
    })

    expect(result).toMatchObject({ imported: 1, failed: 0, registeredProjects: [] })
    expect(registered).toEqual([])
    const destination = result.items[0]!.destinationPath!
    expect(destination).toContain(join('.claude', 'rules', 'imports', 'cursor'))
    expect(await readFile(destination, 'utf-8')).toContain('Cursor project rule')
  })

  it('reports already-registered and missing projects as explicit skips', async () => {
    const existingProject = join(root, 'workspace', 'registered-project')
    const missingProject = join(root, 'workspace', 'missing-project')
    await mkdir(existingProject, { recursive: true })
    await write(
      join(homeDir, '.codex', 'sessions', 'existing.jsonl'),
      JSON.stringify({ cwd: existingProject }),
    )
    await write(
      join(homeDir, '.codex', 'sessions', 'missing.jsonl'),
      JSON.stringify({ cwd: missingProject }),
    )
    const service = createService({ registerProject: async () => false })
    const scan = await service.scan()
    const projects = scan.agents.find(agent => agent.id === 'codex')!.projects
    const existing = projects.find(project => project.exists)!
    const missing = projects.find(project => !project.exists)!

    const existingResult = await service.migrate({ agentId: 'codex', projectIds: [existing.id] })
    const missingResult = await service.migrate({ agentId: 'codex', projectIds: [missing.id] })

    expect(existingResult).toMatchObject({ imported: 0, skipped: 1, failed: 0 })
    expect(existingResult.items[0]?.message).toContain('already registered')
    expect(missingResult).toMatchObject({ imported: 0, skipped: 1, failed: 0 })
    expect(missingResult.items[0]?.message).toContain('no longer exists')
  })

  it('writes Claude Code data to loadable Skill, rule, instruction, and auto-memory formats', async () => {
    const projectPath = join(root, 'workspace', 'claude-target')
    const customMemoryRoot = join(root, 'claude-auto-memory')
    await seedCyberSource(projectPath)
    await write(join(homeDir, '.claude', 'settings.json'), JSON.stringify({
      autoMemoryDirectory: customMemoryRoot,
    }))
    await mkdir(join(homeDir, '.claude'), { recursive: true })

    const service = createService()
    const scan = await service.scan('claude-code')
    const cybercode = scan.agents.find(agent => agent.id === 'cybercode')!
    const canonicalProjectPath = await realpath(projectPath)
    const project = cybercode.projects.find(candidate => candidate.path === canonicalProjectPath)!
    const globals = cybercode.items.filter(item => item.scope === 'global')
    const projectItems = cybercode.items.filter(item => project.itemIds.includes(item.id))

    expect(globals.find(item => item.kind === 'memory')).toMatchObject({
      adaptation: 'converted',
      destinationFormat: 'Claude Code user-level rule',
    })
    expect(projectItems.find(item => item.kind === 'memory')).toMatchObject({
      adaptation: 'native',
      destinationPath: join(customMemoryRoot, 'MEMORY.md'),
    })

    const result = await service.migrate({
      agentId: 'cybercode',
      targetAgentId: 'claude-code',
      itemIds: globals.map(item => item.id),
      projectIds: [project.id],
    })

    expect(result.failed).toBe(0)
    expect(await readFile(join(homeDir, '.claude', 'skills', 'review', 'SKILL.md'), 'utf-8'))
      .toContain('description: "Imported review skill from cybercode."')
    expect(await readFile(join(homeDir, '.claude', 'CLAUDE.md'), 'utf-8'))
      .toContain('CyberCode global rules')
    const userRule = result.items.find(item => item.destinationPath?.includes(join('.claude', 'rules', 'imported-memory-')))!
    expect(await readFile(userRule.destinationPath!, 'utf-8')).toContain('Prefer Bun.')
    expect(await readFile(join(customMemoryRoot, 'MEMORY.md'), 'utf-8')).toContain('Project memory')
    const projectRule = result.items.find(item => item.destinationPath?.includes(join('.claude', 'rules', 'imports')))!
    expect(await readFile(projectRule.destinationPath!, 'utf-8')).toContain('Project CyberCode rules')
  })

  it('converts Cursor global context to Skills and writes valid MDC project rules', async () => {
    const projectPath = join(root, 'workspace', 'cursor-target')
    await seedCyberSource(projectPath)
    await mkdir(join(homeDir, '.cursor'), { recursive: true })

    const service = createService()
    const scan = await service.scan('cursor')
    const cybercode = scan.agents.find(agent => agent.id === 'cybercode')!
    const canonicalProjectPath = await realpath(projectPath)
    const project = cybercode.projects.find(candidate => candidate.path === canonicalProjectPath)!
    const globals = cybercode.items.filter(item => item.scope === 'global')

    expect(globals.filter(item => item.kind !== 'skill').every(item =>
      item.adaptation === 'converted' && item.writeMode === 'agent-skill')).toBe(true)

    const result = await service.migrate({
      agentId: 'cybercode',
      targetAgentId: 'cursor',
      itemIds: globals.map(item => item.id),
      projectIds: [project.id],
    })

    expect(result.failed).toBe(0)
    const globalContextFiles = result.items
      .filter(item => item.destinationPath?.includes(join('.cursor', 'skills', 'imported-')))
      .map(item => item.destinationPath!)
    expect(globalContextFiles).toHaveLength(2)
    for (const filePath of globalContextFiles) {
      const content = await readFile(filePath, 'utf-8')
      expect(content).toContain('name:')
      expect(content).toContain('description:')
    }
    const projectRule = result.items.find(item => item.destinationPath?.endsWith('.mdc')
      && !item.destinationPath.includes('-memory-'))!
    const projectMemory = result.items.find(item => item.destinationPath?.endsWith('.mdc')
      && item.destinationPath.includes('project-memory'))!
    expect(await readFile(projectRule.destinationPath!, 'utf-8')).toContain('alwaysApply: true')
    expect(await readFile(projectMemory.destinationPath!, 'utf-8')).toContain('alwaysApply: false')
  })

  it('places OpenClaw data in its active workspace and keeps detailed memory searchable', async () => {
    const projectPath = join(root, 'workspace', 'openclaw-target')
    const workspace = join(homeDir, '.openclaw', 'workspace')
    await seedCyberSource(projectPath)
    await mkdir(workspace, { recursive: true })

    const service = createService()
    const scan = await service.scan('openclaw')
    const cybercode = scan.agents.find(agent => agent.id === 'cybercode')!
    const canonicalProjectPath = await realpath(projectPath)
    const project = cybercode.projects.find(candidate => candidate.path === canonicalProjectPath)!
    const globals = cybercode.items.filter(item => item.scope === 'global')
    const result = await service.migrate({
      agentId: 'cybercode',
      targetAgentId: 'openclaw',
      itemIds: globals.map(item => item.id),
      projectIds: [project.id],
    })

    expect(result.failed).toBe(0)
    expect(await readFile(join(workspace, 'MEMORY.md'), 'utf-8')).toContain('Prefer Bun.')
    const agentRules = await readFile(join(workspace, 'AGENTS.md'), 'utf-8')
    expect(agentRules).toContain('CyberCode global rules')
    expect(agentRules).toContain('Project CyberCode rules')
    const detailedMemory = result.items.find(item => item.destinationPath?.includes(join(workspace, 'memory')))!
    expect(detailedMemory.destinationPath).not.toContain(join('memory', 'imports'))
    expect(await readFile(detailedMemory.destinationPath!, 'utf-8')).toContain('Project memory')
  })

  it('uses Hermes native bounded memory and project context formats', async () => {
    const projectPath = join(root, 'workspace', 'hermes-target')
    await seedCyberSource(projectPath)
    await write(join(cyberConfigDir, 'prompt-memory', 'BRIEF.md'), 'Keep fixes focused.')
    await mkdir(join(homeDir, '.hermes'), { recursive: true })

    const service = createService()
    const scan = await service.scan('hermes-agent')
    const cybercode = scan.agents.find(agent => agent.id === 'cybercode')!
    const canonicalProjectPath = await realpath(projectPath)
    const project = cybercode.projects.find(candidate => candidate.path === canonicalProjectPath)!
    const globals = cybercode.items.filter(item => item.scope === 'global')
    const result = await service.migrate({
      agentId: 'cybercode',
      targetAgentId: 'hermes-agent',
      itemIds: globals.map(item => item.id),
      projectIds: [project.id],
    })

    expect(result.failed).toBe(0)
    expect(await readFile(join(homeDir, '.hermes', 'memories', 'USER.md'), 'utf-8')).toContain('Prefer Bun.')
    expect(await readFile(join(homeDir, '.hermes', 'memories', 'MEMORY.md'), 'utf-8')).toContain('Keep fixes focused.')
    expect(await readFile(join(homeDir, '.hermes', 'SOUL.md'), 'utf-8')).toContain('CyberCode global rules')
    const projectContext = await readFile(join(projectPath, '.hermes.md'), 'utf-8')
    expect(projectContext).toContain('Project memory')
    expect(projectContext).toContain('Project CyberCode rules')
  })

  it('rejects Hermes memory that would exceed the destination character limit', async () => {
    await write(join(cyberConfigDir, 'prompt-memory', 'BRIEF.md'), 'x'.repeat(2_200))
    await mkdir(join(homeDir, '.hermes'), { recursive: true })
    const service = createService()
    const scan = await service.scan('hermes-agent')
    const memory = scan.agents.find(agent => agent.id === 'cybercode')!
      .items.find(item => item.name === 'BRIEF.md')!

    const result = await service.migrate({
      agentId: 'cybercode',
      targetAgentId: 'hermes-agent',
      itemIds: [memory.id],
    })

    expect(result).toMatchObject({ imported: 0, failed: 1 })
    expect(result.items[0]?.message).toContain('2200-character limit')
    await expect(readFile(join(homeDir, '.hermes', 'memories', 'MEMORY.md'), 'utf-8')).rejects.toThrow()
  })

  it('writes CodeWhale memory and direct project rules using current canonical paths', async () => {
    const projectPath = join(root, 'workspace', 'codewhale-target')
    const customMemoryPath = join(root, 'codewhale-memory.md')
    await seedCyberSource(projectPath)
    await write(join(homeDir, '.codewhale', 'config.toml'), [
      `memory_path = ${JSON.stringify(customMemoryPath)}`,
      '[memory]',
      'enabled = true',
    ].join('\n'))

    const service = createService()
    const scan = await service.scan('deepseek-tui')
    const cybercode = scan.agents.find(agent => agent.id === 'cybercode')!
    const canonicalProjectPath = await realpath(projectPath)
    const project = cybercode.projects.find(candidate => candidate.path === canonicalProjectPath)!
    const globals = cybercode.items.filter(item => item.scope === 'global')
    expect(globals.find(item => item.kind === 'memory')).toMatchObject({
      destinationPath: customMemoryPath,
      adaptation: 'native',
      writeMode: 'codewhale-memory',
    })

    const result = await service.migrate({
      agentId: 'cybercode',
      targetAgentId: 'deepseek-tui',
      itemIds: globals.map(item => item.id),
      projectIds: [project.id],
    })

    expect(result.failed).toBe(0)
    expect(await readFile(customMemoryPath, 'utf-8')).toContain('Prefer Bun.')
    expect(await readFile(join(homeDir, '.agents', 'AGENTS.md'), 'utf-8'))
      .toContain('CyberCode global rules')
    const projectRules = result.items.filter(item => item.destinationPath?.includes(join('.codewhale', 'rules')))
    expect(projectRules).toHaveLength(2)
    expect(projectRules.every(item => !item.destinationPath!.includes(join('rules', 'imports')))).toBe(true)
    expect(await Promise.all(projectRules.map(item => readFile(item.destinationPath!, 'utf-8'))))
      .toEqual(expect.arrayContaining([
        expect.stringContaining('Project memory'),
        expect.stringContaining('Project CyberCode rules'),
      ]))
  })

  it('warns when migrated CodeWhale memory is not enabled yet', async () => {
    await write(join(cyberConfigDir, 'prompt-memory', 'USER.md'), 'Prefer Bun.')
    await mkdir(join(homeDir, '.codewhale'), { recursive: true })
    const service = createService()
    const scan = await service.scan('deepseek-tui')
    const memory = scan.agents.find(agent => agent.id === 'cybercode')!
      .items.find(item => item.kind === 'memory')!

    const result = await service.migrate({
      agentId: 'cybercode',
      targetAgentId: 'deepseek-tui',
      itemIds: [memory.id],
    })

    expect(result).toMatchObject({ imported: 1, failed: 0 })
    expect(result.items[0]?.message).toContain('currently disabled')
    expect(await readFile(join(homeDir, '.codewhale', 'memory.md'), 'utf-8')).toContain('Prefer Bun.')
  })

  it('uses the configured OpenClaw JSON5 workspace before environment and fallback paths', async () => {
    const configuredWorkspace = join(root, 'openclaw-configured-workspace')
    const envWorkspace = join(root, 'openclaw-env-workspace')
    await mkdir(configuredWorkspace, { recursive: true })
    await mkdir(envWorkspace, { recursive: true })
    await write(join(homeDir, '.openclaw', 'openclaw.json'), [
      '{',
      '  // OpenClaw accepts JSON5 configuration.',
      '  agents: {',
      `    defaults: { workspace: ${JSON.stringify(configuredWorkspace)}, },`,
      '  },',
      '}',
    ].join('\n'))
    await write(join(cyberConfigDir, 'prompt-memory', 'USER.md'), 'Prefer Bun.')

    const service = createService({
      env: { OPENCLAW_WORKSPACE_DIR: envWorkspace },
    })
    const scan = await service.scan('openclaw')
    const cyberMemory = scan.agents.find(agent => agent.id === 'cybercode')!
      .items.find(item => item.kind === 'memory')!

    expect(cyberMemory.destinationPath).toBe(join(configuredWorkspace, 'MEMORY.md'))
    const openClaw = scan.agents.find(agent => agent.id === 'openclaw')!
    expect(openClaw.installed).toBe(true)
    expect(openClaw.dataRoots).toEqual(expect.arrayContaining([
      configuredWorkspace,
      envWorkspace,
    ]))
  })

  it('detects an empty profile-specific OpenClaw workspace as an installed source', async () => {
    const workspace = join(homeDir, '.openclaw', 'workspace-work')
    await mkdir(workspace, { recursive: true })
    const service = createService({ env: { OPENCLAW_PROFILE: 'work' } })

    const scan = await service.scan()
    const openClaw = scan.agents.find(agent => agent.id === 'openclaw')!

    expect(openClaw.installed).toBe(true)
    expect(openClaw.dataRoots).toContain(workspace)
  })

  it('does not treat a regular file as an installed agent data directory', async () => {
    await write(join(homeDir, '.claude'), 'not a directory')

    const scan = await createService().scan()
    const claude = scan.agents.find(agent => agent.id === 'claude-code')!

    expect(claude.installed).toBe(false)
    expect(claude.dataRoots).toEqual([])
  })

  it('never re-imports external data that resolves inside the CyberCode store', async () => {
    const aliasedWorkspace = join(cyberConfigDir, 'external-looking-workspace')
    await write(join(aliasedWorkspace, 'MEMORY.md'), 'Must not import itself')
    const service = createService({
      env: { OPENCLAW_WORKSPACE_DIR: aliasedWorkspace },
    })

    const scan = await service.scan()
    const openClaw = scan.agents.find(agent => agent.id === 'openclaw')!

    expect(openClaw.items).toEqual([])
    expect(openClaw.projects).toEqual([])
  })

  it('ignores repository-controlled Claude auto-memory redirects', async () => {
    const projectPath = join(root, 'workspace', 'untrusted-claude-project')
    const redirected = join(root, 'must-not-be-used')
    await seedCyberSource(projectPath)
    await write(join(projectPath, '.claude', 'settings.json'), JSON.stringify({
      autoMemoryDirectory: redirected,
    }))
    await mkdir(join(homeDir, '.claude'), { recursive: true })

    const service = createService()
    const scan = await service.scan('claude-code')
    const cybercode = scan.agents.find(agent => agent.id === 'cybercode')!
    const canonicalProjectPath = await realpath(projectPath)
    const project = cybercode.projects.find(candidate => candidate.path === canonicalProjectPath)!
    const memory = cybercode.items.find(item =>
      project.itemIds.includes(item.id) && item.kind === 'memory')!

    expect(memory.destinationPath).not.toContain(redirected)
    expect(memory.destinationPath).toContain(join(homeDir, '.claude', 'projects'))
  })

  it('discovers Claude user rules and project-local instruction files', async () => {
    const projectPath = join(root, 'workspace', 'claude-rules-project')
    await mkdir(projectPath, { recursive: true })
    await write(join(homeDir, '.claude', 'rules', 'testing.md'), '# User testing rule')
    await write(join(projectPath, '.claude', 'CLAUDE.md'), '# Project .claude rule')
    await write(join(projectPath, 'CLAUDE.local.md'), '# Local project rule')
    await write(
      join(homeDir, '.claude', 'projects', projectPath.replace(/[^a-zA-Z0-9]/g, '-'), 'session.jsonl'),
      JSON.stringify({ type: 'session_meta', cwd: projectPath }),
    )

    const scan = await createService().scan()
    const claude = scan.agents.find(agent => agent.id === 'claude-code')!
    const sourcePaths = claude.items.map(item => item.sourcePath)

    expect(sourcePaths).toEqual(expect.arrayContaining([
      await realpath(join(homeDir, '.claude', 'rules', 'testing.md')),
      await realpath(join(projectPath, '.claude', 'CLAUDE.md')),
      await realpath(join(projectPath, 'CLAUDE.local.md')),
    ]))
  })

  it('uses the active legacy CodeWhale root and its loadable global rule path', async () => {
    const customMemoryPath = join(root, 'legacy-codewhale-memory.md')
    await seedCyberSource(join(root, 'workspace', 'legacy-codewhale-target'))
    await write(join(homeDir, '.deepseek', 'config.toml'), [
      `memory_path = ${JSON.stringify(customMemoryPath)}`,
      '[memory]',
      'enabled = true',
    ].join('\n'))

    const service = createService()
    const scan = await service.scan('deepseek-tui')
    const cybercode = scan.agents.find(agent => agent.id === 'cybercode')!
    const memory = cybercode.items.find(item => item.kind === 'memory' && item.scope === 'global')!
    const instruction = cybercode.items.find(item => item.kind === 'instruction' && item.scope === 'global')!

    expect(memory.destinationPath).toBe(customMemoryPath)
    expect(instruction.destinationPath).toBe(join(homeDir, '.agents', 'AGENTS.md'))
    const result = await service.migrate({
      agentId: 'cybercode',
      targetAgentId: 'deepseek-tui',
      itemIds: [memory.id, instruction.id],
    })
    expect(result).toMatchObject({ imported: 2, failed: 0 })
    expect(result.items.every(item => !item.message?.includes('disabled'))).toBe(true)
  })

  it('targets the active Hermes profile and the native Windows data root', async () => {
    const activeProfile = join(homeDir, '.hermes', 'profiles', 'work')
    await mkdir(activeProfile, { recursive: true })
    await write(join(homeDir, '.hermes', 'active_profile'), 'work\n')
    await write(join(cyberConfigDir, 'prompt-memory', 'USER.md'), 'Prefer Bun.')

    const profileScan = await createService().scan('hermes-agent')
    const profileMemory = profileScan.agents.find(agent => agent.id === 'cybercode')!
      .items.find(item => item.kind === 'memory')!
    expect(profileMemory.destinationPath).toBe(join(activeProfile, 'memories', 'USER.md'))

    await rm(join(homeDir, '.hermes'), { recursive: true, force: true })
    const localAppData = join(root, 'local-app-data')
    const windowsHermes = join(localAppData, 'hermes')
    await mkdir(windowsHermes, { recursive: true })
    const windowsScan = await createService({
      platform: 'win32',
      env: { LOCALAPPDATA: localAppData },
    }).scan('hermes-agent')
    const windowsMemory = windowsScan.agents.find(agent => agent.id === 'cybercode')!
      .items.find(item => item.kind === 'memory')!
    expect(windowsMemory.destinationPath).toBe(join(windowsHermes, 'memories', 'USER.md'))
  })

  it('marks skills over the file-count limit as non-selectable', async () => {
    const skillRoot = join(homeDir, '.codex', 'skills', 'too-many-files')
    await write(join(skillRoot, 'SKILL.md'), '# Large skill')
    await Promise.all(Array.from({ length: 200 }, (_, index) =>
      write(join(skillRoot, `file-${index}.txt`), String(index))))

    const service = createService()
    const scan = await service.scan()
    const skill = scan.agents.find(agent => agent.id === 'codex')!
      .items.find(item => item.name === 'too-many-files')!

    expect(skill.selectable).toBe(false)
    const result = await service.migrate({ agentId: 'codex', itemIds: [skill.id] })
    expect(result).toMatchObject({ imported: 0, skipped: 1, failed: 0 })
  })

  it('does not expose an in-progress temporary skill as a migration source', async () => {
    await write(join(homeDir, '.codex', 'skills', 'ready', 'SKILL.md'), '# Ready')
    await write(
      join(homeDir, '.codex', 'skills', 'ready.importing-123-456', 'SKILL.md'),
      '# Partial copy',
    )

    const scan = await createService().scan()
    const skills = scan.agents.find(agent => agent.id === 'codex')!
      .items.filter(item => item.kind === 'skill')

    expect(skills.map(item => item.name)).toEqual(['ready'])
  })

  it('compares every skill asset and keeps collision updates on one stable path', async () => {
    const sourceRoot = join(homeDir, '.codex', 'skills', 'review')
    const targetRoot = join(cyberConfigDir, 'skills', 'review')
    const skill = [
      '---',
      'name: review',
      'description: Review code',
      '---',
      '# Review',
    ].join('\n')
    await write(join(sourceRoot, 'SKILL.md'), skill)
    await write(join(sourceRoot, 'prompt'), 'source-v1')
    await write(join(targetRoot, 'SKILL.md'), skill)
    await write(join(targetRoot, 'prompt'), 'target-original')
    const service = createService()
    const scan = await service.scan()
    const source = scan.agents.find(agent => agent.id === 'codex')!
      .items.find(item => item.kind === 'skill' && item.name === 'review')!

    const first = await service.migrate({ agentId: 'codex', itemIds: [source.id] })
    expect(first).toMatchObject({ imported: 1, skipped: 0, failed: 0 })
    const importedRoot = first.items[0]!.destinationPath!
    expect(importedRoot).toContain('review-from-codex-')
    expect(await readFile(join(importedRoot, 'prompt'), 'utf-8')).toBe('source-v1')
    expect(await readFile(join(targetRoot, 'prompt'), 'utf-8')).toBe('target-original')

    await writeFile(join(sourceRoot, 'prompt'), 'source-v2', 'utf-8')
    const second = await service.migrate({ agentId: 'codex', itemIds: [source.id] })
    expect(second).toMatchObject({ imported: 1, skipped: 0, failed: 0 })
    expect(second.items[0]!.destinationPath).toBe(importedRoot)
    expect(await readFile(join(importedRoot, 'prompt'), 'utf-8')).toBe('source-v2')
    expect((await readdir(join(cyberConfigDir, 'skills'))).filter(name => name.startsWith('review'))).toHaveLength(2)
  })

  it('never replaces an existing destination with the wrong filesystem type', async () => {
    await write(join(homeDir, '.openclaw', 'workspace', 'MEMORY.md'), 'Memory source')
    await write(join(homeDir, '.codex', 'skills', 'review', 'SKILL.md'), '# Review source')
    const service = createService()
    const scan = await service.scan()
    const openClawMemory = scan.agents.find(agent => agent.id === 'openclaw')!
      .items.find(item => item.kind === 'memory')!
    const codexSkill = scan.agents.find(agent => agent.id === 'codex')!
      .items.find(item => item.kind === 'skill')!
    await mkdir(openClawMemory.destinationPath, { recursive: true })
    await write(codexSkill.destinationPath, 'keep-this-file')

    const memoryResult = await service.migrate({ agentId: 'openclaw', itemIds: [openClawMemory.id] })
    const skillResult = await service.migrate({ agentId: 'codex', itemIds: [codexSkill.id] })

    expect(memoryResult).toMatchObject({ imported: 0, skipped: 1, failed: 0 })
    expect(skillResult).toMatchObject({ imported: 0, skipped: 1, failed: 0 })
    expect(memoryResult.items[0]?.message).toContain('incompatible file type')
    expect(skillResult.items[0]?.message).toContain('incompatible file type')
    expect((await stat(openClawMemory.destinationPath)).isDirectory()).toBe(true)
    expect(await readFile(codexSkill.destinationPath, 'utf-8')).toBe('keep-this-file')
  })

  it('preserves the original destination once when several items merge in one batch', async () => {
    await write(join(cyberConfigDir, 'CYBER.md'), '# Original Cyber rules\n')
    await write(join(homeDir, '.openclaw', 'workspace', 'AGENTS.md'), '# Imported agents')
    await write(join(homeDir, '.openclaw', 'workspace', 'SOUL.md'), '# Imported soul')
    const service = createService()
    const scan = await service.scan()
    const instructions = scan.agents.find(agent => agent.id === 'openclaw')!
      .items.filter(item => item.kind === 'instruction' && item.scope === 'global')

    const result = await service.migrate({
      agentId: 'openclaw',
      itemIds: instructions.map(item => item.id),
    })

    expect(result).toMatchObject({ imported: 2, failed: 0 })
    const backupRoot = join(cyberConfigDir, 'migration-backups')
    const batches = await readdir(backupRoot)
    const backups = await readdir(join(backupRoot, batches[0]!))
    const cyberBackup = backups.find(name => name.endsWith('-CYBER.md'))!
    expect(await readFile(join(backupRoot, batches[0]!, cyberBackup), 'utf-8'))
      .toBe('# Original Cyber rules\n')
  })

  it('serializes concurrent migrations so merged content is never lost', async () => {
    await write(join(homeDir, '.openclaw', 'workspace', 'AGENTS.md'), '# Concurrent agents rule')
    await write(join(homeDir, '.openclaw', 'workspace', 'SOUL.md'), '# Concurrent soul rule')
    const service = createService()
    const scan = await service.scan()
    const instructions = scan.agents.find(agent => agent.id === 'openclaw')!
      .items.filter(item => item.kind === 'instruction' && item.scope === 'global')

    const results = await Promise.all(instructions.map(item => service.migrate({
      agentId: 'openclaw',
      itemIds: [item.id],
    })))

    expect(results.every(result => result.imported === 1 && result.failed === 0)).toBe(true)
    const merged = await readFile(join(cyberConfigDir, 'CYBER.md'), 'utf-8')
    expect(merged).toContain('Concurrent agents rule')
    expect(merged).toContain('Concurrent soul rule')
  })

  it('does not report a successful migration as failed when audit logging is unavailable', async () => {
    const blockedCyberConfig = join(root, 'blocked-cyber-config')
    await write(blockedCyberConfig, 'not a directory')
    await write(join(homeDir, '.openclaw', 'workspace', 'MEMORY.md'), 'Remember this')
    await mkdir(join(homeDir, '.claude'), { recursive: true })
    const service = createService({ cyberConfigDir: blockedCyberConfig })
    const scan = await service.scan('claude-code')
    const memory = scan.agents.find(agent => agent.id === 'openclaw')!
      .items.find(item => item.kind === 'memory')!

    const result = await service.migrate({
      agentId: 'openclaw',
      targetAgentId: 'claude-code',
      itemIds: [memory.id],
    })

    expect(result).toMatchObject({ imported: 1, failed: 0 })
    expect(await readFile(result.items[0]!.destinationPath!, 'utf-8')).toContain('Remember this')
  })

  it('bounds text previews without loading an entire large source file', async () => {
    await write(join(homeDir, '.openclaw', 'workspace', 'MEMORY.md'), 'x'.repeat(400_000))
    const service = createService()
    const scan = await service.scan()
    const memory = scan.agents.find(agent => agent.id === 'openclaw')!
      .items.find(item => item.kind === 'memory')!

    const preview = await service.preview('openclaw', memory.id)

    expect(preview.truncated).toBe(true)
    expect(Buffer.byteLength(preview.content, 'utf-8')).toBeLessThanOrEqual(160 * 1024)
  })

  it('sanitizes traversal, Windows device, and Unicode-only skill names distinctly', async () => {
    const cases = [
      ['dot-name', '..'],
      ['device-name', 'CON'],
      ['unicode-name', '代码审查'],
    ] as const
    for (const [directory, name] of cases) {
      await write(join(homeDir, '.codex', 'skills', directory, 'SKILL.md'), [
        '---',
        `name: ${name}`,
        'description: Imported test skill',
        '---',
        '# Test',
      ].join('\n'))
    }

    const scan = await createService().scan()
    const skills = scan.agents.find(agent => agent.id === 'codex')!
      .items.filter(item => item.kind === 'skill')
    const destinationNames = skills.map(item => basename(item.destinationPath))

    expect(destinationNames).toHaveLength(3)
    expect(new Set(destinationNames).size).toBe(3)
    expect(destinationNames).not.toContain('..')
    expect(destinationNames.map(name => name.toLowerCase())).not.toContain('con')
    expect(skills.every(item => item.destinationPath.startsWith(join(cyberConfigDir, 'skills')))).toBe(true)
  })

  it('respects custom Claude and Codex homes without a shell-dependent migration path', async () => {
    const claudeHome = join(root, 'profiles', 'claude')
    const codexHome = join(root, 'profiles', 'codex')
    await write(join(claudeHome, 'CLAUDE.md'), '# Custom Claude home')
    await write(join(codexHome, 'AGENTS.md'), '# Custom Codex home')
    await write(join(codexHome, 'skills', 'custom-codex-skill', 'SKILL.md'), '# Custom Codex skill')
    await write(join(cyberConfigDir, 'CYBER.md'), '# Cyber rules')
    const executableChecks: string[] = []
    const service = createService({
      env: {
        CLAUDE_CONFIG_DIR: claudeHome,
        CODEX_HOME: codexHome,
      },
      findExecutable: command => {
        executableChecks.push(command)
        return null
      },
    })

    const sourceScan = await service.scan()
    expect(sourceScan.agents.find(agent => agent.id === 'claude-code')?.dataRoots).toContain(claudeHome)
    const codexSource = sourceScan.agents.find(agent => agent.id === 'codex')!
    expect(codexSource.dataRoots).toContain(codexHome)
    expect(codexSource.items.map(item => item.sourcePath)).toEqual(expect.arrayContaining([
      await realpath(join(codexHome, 'AGENTS.md')),
      await realpath(join(codexHome, 'skills', 'custom-codex-skill', 'SKILL.md')),
    ]))

    const targetScan = await service.scan('codex')
    const cyberRules = targetScan.agents.find(agent => agent.id === 'cybercode')!
      .items.find(item => item.name === 'CYBER.md')!
    expect(cyberRules.destinationPath).toBe(join(codexHome, 'AGENTS.md'))
    expect(executableChecks).toEqual(expect.arrayContaining(['claude', 'codex']))
  })

  it('rejects a migration whose source and destination are the same agent', async () => {
    const service = createService()

    await expect(service.migrate({
      agentId: 'cybercode',
      targetAgentId: 'cybercode',
      allRecommended: true,
    })).rejects.toMatchObject({ code: 'SAME_AGENT' })
  })

  it('rejects malformed migration IDs at the HTTP boundary', async () => {
    const url = new URL('http://127.0.0.1/api/agent-migration/migrate')
    const response = await handleAgentMigrationApi(
      new Request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agentId: 'codex',
          targetAgentId: 'cybercode',
          itemIds: ['../../not-an-id'],
        }),
      }),
      url,
      ['api', 'agent-migration', 'migrate'],
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'BAD_REQUEST' })
  })

  function createService(overrides: Partial<ConstructorParameters<typeof AgentMigrationService>[0]> = {}) {
    return new AgentMigrationService({
      homeDir,
      cyberConfigDir,
      env: {},
      findExecutable: () => null,
      registerProject: async () => false,
      refreshSearchIndex: async () => {},
      ...overrides,
    })
  }

  async function seedCyberSource(projectPath: string): Promise<void> {
    await mkdir(projectPath, { recursive: true })
    await write(join(cyberConfigDir, 'skills', 'review', 'SKILL.md'), '# Review workflow')
    await write(join(cyberConfigDir, 'CYBER.md'), '# CyberCode global rules')
    await write(join(cyberConfigDir, 'prompt-memory', 'USER.md'), 'Prefer Bun.')
    const projectStore = join(cyberConfigDir, 'projects', projectPath.replace(/[^a-zA-Z0-9]/g, '-'))
    await write(
      join(projectStore, 'session.jsonl'),
      JSON.stringify({ type: 'session_meta', payload: { cwd: projectPath } }),
    )
    await write(join(projectStore, 'memory', 'project-memory.md'), '# Project memory\nUse focused tests.')
    await write(join(projectPath, 'CYBER.md'), '# Project CyberCode rules')
  }
})

async function write(filePath: string, content: string): Promise<void> {
  await mkdir(join(filePath, '..'), { recursive: true })
  await writeFile(filePath, content, 'utf-8')
}
