import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import { buildMcpToolName } from '../../services/mcp/mcpStringUtils.js'
import type { ScopedMcpServerConfig } from '../../services/mcp/types.js'
import { registerCleanup } from '../cleanupRegistry.js'

export const AGENT_BROWSER_MCP_SERVER_NAME = 'agent-browser'
const CYBERCODE_AGENT_BROWSER_IDLE_TIMEOUT_MS = '1800000'
const AGENT_BROWSER_CLOSE_TIMEOUT_MS = 2000
const AGENT_BROWSER_DAEMON_SETTLE_TIMEOUT_MS = 750
const AGENT_BROWSER_DAEMON_SETTLE_INTERVAL_MS = 25

let unregisterAgentBrowserCleanup: (() => void) | null = null

const CORE_TOOLS = [
  'agent_browser_tools_profiles',
  'agent_browser_open',
  'agent_browser_read',
  'agent_browser_snapshot',
  'agent_browser_click',
  'agent_browser_fill',
  'agent_browser_type',
  'agent_browser_press',
  'agent_browser_check',
  'agent_browser_uncheck',
  'agent_browser_select',
  'agent_browser_scroll',
  'agent_browser_wait_ms',
  'agent_browser_wait_for_selector',
  'agent_browser_wait_for_text',
  'agent_browser_wait_for_load',
  'agent_browser_screenshot',
  'agent_browser_get_text',
  'agent_browser_get_url',
  'agent_browser_get_title',
  'agent_browser_eval',
  'agent_browser_close',
  'agent_browser_back',
  'agent_browser_forward',
  'agent_browser_reload',
  'agent_browser_tab_new',
  'agent_browser_tab_list',
  'agent_browser_tab_switch',
  'agent_browser_tab_close',
] as const

export const AGENT_BROWSER_SYSTEM_PROMPT = [
  'For websites and local web apps, prefer the agent-browser MCP tools.',
  'Open the page, take a compact accessibility snapshot, and use its stable element refs before clicking or typing.',
  'Browser-page screenshots do not require operating-system screen-recording permission.',
  "Use Computer Use instead when the task requires the full desktop, another application, or the user's already-open browser session.",
].join(' ')

export function resolveAgentBrowserBinary(): string | null {
  const configuredPath = process.env.CYBER_AGENT_BROWSER_PATH?.trim()
  if (configuredPath && existsSync(configuredPath)) return configuredPath

  const siblingName =
    process.platform === 'win32' ? 'agent-browser.exe' : 'agent-browser'
  const siblingPath = path.join(path.dirname(process.execPath), siblingName)
  if (existsSync(siblingPath)) return siblingPath

  return typeof Bun !== 'undefined' ? Bun.which('agent-browser') : null
}

export function buildAgentBrowserSessionName(sessionId: string): string {
  const normalized = sessionId
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const base = normalized || 'session'
  const prefix = 'cybercode-'
  const maxBaseLength = 64 - prefix.length
  if (base.length <= maxBaseLength) return `${prefix}${base}`

  const digest = createHash('sha256').update(sessionId).digest('hex').slice(0, 8)
  return `${prefix}${base.slice(0, maxBaseLength - digest.length - 1)}-${digest}`
}

function resolveAgentBrowserSocketDir(): string {
  return (
    process.env.AGENT_BROWSER_SOCKET_DIR ||
    path.join(homedir(), '.cyber', 'agent-browser')
  )
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}

async function closeOwnedAgentBrowserSession(
  command: string,
  sessionName: string,
  socketDir: string,
): Promise<boolean> {
  const pidPath = path.join(socketDir, `${sessionName}.pid`)
  if (!existsSync(pidPath) || typeof Bun === 'undefined') return false

  let closeProcess: ReturnType<typeof Bun.spawn> | null = null
  try {
    closeProcess = Bun.spawn(
      [command, '--session', sessionName, '--json', 'close'],
      {
        env: {
          ...process.env,
          AGENT_BROWSER_SESSION: sessionName,
          AGENT_BROWSER_SOCKET_DIR: socketDir,
        },
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'ignore',
      },
    )

    let timeout: ReturnType<typeof setTimeout> | undefined
    const exitCode = await Promise.race([
      closeProcess.exited,
      new Promise<null>((resolve) => {
        timeout = setTimeout(resolve, AGENT_BROWSER_CLOSE_TIMEOUT_MS, null)
        timeout.unref?.()
      }),
    ])
    if (timeout) clearTimeout(timeout)

    if (exitCode === null) {
      try {
        closeProcess.kill()
      } catch {
        // The close helper may have exited between the timeout and kill.
      }
      return false
    }
    if (exitCode !== 0) return false

    const settleDeadline =
      Date.now() + AGENT_BROWSER_DAEMON_SETTLE_TIMEOUT_MS
    while (existsSync(pidPath) && Date.now() < settleDeadline) {
      await wait(AGENT_BROWSER_DAEMON_SETTLE_INTERVAL_MS)
    }
    return !existsSync(pidPath)
  } catch {
    return false
  }
}

export async function closeAgentBrowserSession(
  sessionId: string,
): Promise<boolean> {
  const command = resolveAgentBrowserBinary()
  if (!command) return false

  return closeOwnedAgentBrowserSession(
    command,
    buildAgentBrowserSessionName(sessionId),
    resolveAgentBrowserSocketDir(),
  )
}

export function describeAgentBrowserUnavailableReason(): string | null {
  if (resolveAgentBrowserBinary()) return null
  const configuredPath = process.env.CYBER_AGENT_BROWSER_PATH?.trim()
  if (configuredPath) {
    return `the binary at CYBER_AGENT_BROWSER_PATH (${configuredPath}) does not exist`
  }
  return 'the agent-browser binary was not found next to the CyberCode executable or on PATH'
}

export function setupAgentBrowserMCP(): {
  mcpConfig: Record<string, ScopedMcpServerConfig>
  allowedTools: string[]
  systemPrompt: string
} | null {
  const command = resolveAgentBrowserBinary()
  if (!command) return null

  const socketDir = resolveAgentBrowserSocketDir()
  const env: Record<string, string> = {
    AGENT_BROWSER_SOCKET_DIR: socketDir,
  }
  const cybercodeSessionId =
    process.env.CYBERCODE_AGENT_BROWSER_SESSION_ID?.trim()
  const configuredSession = process.env.AGENT_BROWSER_SESSION?.trim()
  let sessionName: string
  if (cybercodeSessionId) {
    sessionName = buildAgentBrowserSessionName(cybercodeSessionId)
  } else if (configuredSession) {
    sessionName = configuredSession
  } else {
    sessionName = buildAgentBrowserSessionName(`cli-${process.pid}`)
  }
  env.AGENT_BROWSER_SESSION = sessionName
  env.AGENT_BROWSER_IDLE_TIMEOUT_MS =
    process.env.AGENT_BROWSER_IDLE_TIMEOUT_MS ||
    CYBERCODE_AGENT_BROWSER_IDLE_TIMEOUT_MS

  const browserExecutable =
    process.env.CYBER_AGENT_BROWSER_EXECUTABLE_PATH?.trim()
  if (browserExecutable) {
    env.AGENT_BROWSER_EXECUTABLE_PATH = browserExecutable
  }

  unregisterAgentBrowserCleanup?.()
  unregisterAgentBrowserCleanup = registerCleanup(async () => {
    await closeOwnedAgentBrowserSession(command, sessionName, socketDir)
  })

  return {
    mcpConfig: {
      [AGENT_BROWSER_MCP_SERVER_NAME]: {
        type: 'stdio',
        command,
        args: ['mcp', '--tools', 'core'],
        env,
        scope: 'dynamic',
      },
    },
    allowedTools: CORE_TOOLS.map((toolName) =>
      buildMcpToolName(AGENT_BROWSER_MCP_SERVER_NAME, toolName),
    ),
    systemPrompt: AGENT_BROWSER_SYSTEM_PROMPT,
  }
}
