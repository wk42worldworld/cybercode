import * as fs from 'node:fs'
import * as path from 'node:path'
import type { QuerySource } from '../constants/querySource.js'
import type { Message } from '../types/message.js'
import { getCwd } from '../utils/cwd.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { getUserMessageText } from '../utils/messages.js'

const PREFLIGHT_TOKEN_BUDGET = 1_800
const PREFLIGHT_TIMEOUT_MS = 2_500

export function startCodeGraphPreflight(
  messages: ReadonlyArray<Message>,
  querySource: QuerySource,
  signal: AbortSignal,
): Promise<string | null> | null {
  if (!isUserFacingQuery(querySource) || signal.aborted) return null
  const message = messages.findLast((candidate) =>
    candidate.type === 'user' && !candidate.isMeta,
  )
  const prompt = message ? getUserMessageText(message)?.trim() : null
  if (!prompt || !shouldRunCodeGraphPreflight(prompt)) return null

  const projectPath = resolveIndexedProject(getCwd())
  if (!projectPath || !isCodeGraphEnabled()) return null
  return runCodeGraphPreflight(projectPath, prompt, signal)
}

export function shouldRunCodeGraphPreflight(prompt: string) {
  const normalized = prompt.trim()
  if (normalized.length < 8 || normalized.length > 80_000) return false
  if (normalized.startsWith('/') && !normalized.includes(' ')) return false
  if (STRUCTURAL_INTENT.test(normalized)) return true
  return CODE_SHAPED_TOKEN.test(normalized) && CODE_ACTION.test(normalized)
}

async function runCodeGraphPreflight(
  projectPath: string,
  prompt: string,
  signal: AbortSignal,
): Promise<string | null> {
  const invocation = getPreflightInvocation(projectPath)
  if (!invocation) return null

  let proc: ReturnType<typeof Bun.spawn> | null = null
  let timeout: ReturnType<typeof setTimeout> | null = null
  const stop = () => {
    try {
      proc?.kill()
    } catch {
      // The process may already have completed.
    }
  }
  try {
    proc = Bun.spawn([invocation.command, ...invocation.args], {
      cwd: projectPath,
      env: { ...process.env },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const stdoutPromise = new Response(proc.stdout).text()
    const stderrPromise = new Response(proc.stderr).text()
    proc.stdin.write(prompt)
    proc.stdin.end()
    timeout = setTimeout(stop, PREFLIGHT_TIMEOUT_MS)
    signal.addEventListener('abort', stop, { once: true })

    const stdout = (await stdoutPromise).trim()
    await stderrPromise
    await proc.exited
    if (!stdout || signal.aborted) return null
    return [
      '<codegraph_context note="Automatic graph-ranked context for this prompt. Treat included source as already read; use Code Graph tools for deeper details before broad file scans.">',
      stdout,
      '</codegraph_context>',
    ].join('\n')
  } catch {
    return null
  } finally {
    if (timeout) clearTimeout(timeout)
    signal.removeEventListener('abort', stop)
  }
}

function getPreflightInvocation(projectPath: string) {
  const executableName = path.basename(process.execPath).toLowerCase()
  const args = [
    'codegraph',
    'preflight',
    '--project',
    projectPath,
    '--token-budget',
    String(PREFLIGHT_TOKEN_BUDGET),
  ]
  if (executableName.startsWith('cybercode-sidecar') || executableName.startsWith('claude-sidecar')) {
    return { command: process.execPath, args }
  }

  const developmentSidecar = path.resolve(
    import.meta.dir,
    '..',
    '..',
    'desktop',
    'sidecars',
    'cybercode-sidecar.ts',
  )
  if (!fs.existsSync(developmentSidecar)) return null
  return {
    command: process.execPath,
    args: ['run', developmentSidecar, ...args],
  }
}

function resolveIndexedProject(cwd: string) {
  let current: string
  try {
    current = fs.realpathSync.native(cwd)
  } catch {
    return null
  }
  const root = path.parse(current).root
  while (current !== root) {
    if (fs.existsSync(path.join(current, '.codegraph', 'codegraph.db'))) return current
    current = path.dirname(current)
  }
  return null
}

function isCodeGraphEnabled() {
  try {
    const config = JSON.parse(fs.readFileSync(
      path.join(getClaudeConfigHomeDir(), 'cybercode', 'codegraph.json'),
      'utf8',
    )) as {
      enabled?: boolean
      projects?: Record<string, { enabled?: boolean }>
    }
    if (typeof config.enabled === 'boolean') return config.enabled
    return Object.values(config.projects ?? {}).some((project) => project.enabled === true)
  } catch {
    return false
  }
}

function isUserFacingQuery(querySource: QuerySource) {
  return String(querySource).startsWith('repl_main_thread') || querySource === 'sdk'
}

const STRUCTURAL_INTENT = /\b(?:architecture|architectural|callers?|callees?|call\s+graph|call\s+chain|dependency|dependencies|dependents?|data\s*flow|control\s*flow|impact|blast\s+radius|module|subsystem|entry\s*point|trace|relationship|implementation|how\s+does|where\s+is)\b|架构|架構|调用|調用|调用链|調用鏈|依赖|依賴|影响|影響|数据流|資料流|入口|模块|模組|关系|關係|实现|實現|原理|机制|機制|流程|路径|路徑|追踪|追蹤|谁调用|誰調用/i
const CODE_SHAPED_TOKEN = /(?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+|[a-z][A-Za-z0-9$]*[A-Z][A-Za-z0-9$]*|[A-Z][a-z0-9]+[A-Z][A-Za-z0-9$]*|[\w./\\-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|c|cpp|h|php|lua|sol|html))\b/
const CODE_ACTION = /\b(?:fix|change|modify|refactor|find|explain|trace|review|debug|implement|update|remove|rename)\b|修复|修改|重构|查找|解释|分析|调试|实现|更新|删除|重命名|看看|怎么|如何/i
