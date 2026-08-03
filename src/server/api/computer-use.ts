/**
 * Computer Use API — 运行组件、系统权限与应用授权
 *
 * Routes:
 *   GET    /api/computer-use/status   — 检测运行组件与系统权限
 *   GET    /api/computer-use/runtime  — 获取后台准备进度
 *   POST   /api/computer-use/runtime  — 开始或继续后台准备
 *   DELETE /api/computer-use/runtime  — 暂停后台下载
 *   POST   /api/computer-use/setup    — 旧版 venv 安装兼容入口
 */

import { join } from 'path'
import { access, readFile, mkdir, writeFile } from 'fs/promises'
import { createHash } from 'crypto'
import path from 'path'
import type { CuPermissionRequest } from '../../vendor/computer-use-mcp/types.js'
import { computerUseApprovalService } from '../services/computerUseApprovalService.js'
import { getActiveSessionIds, sendToSession } from '../ws/handler.js'
import { detectPythonRuntime } from './computer-use-python.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { logForDebugging } from '../../utils/debug.js'
import { DEFAULT_DESKTOP_GRANT_FLAGS } from '../../utils/computerUse/preauthorizedConfig.js'
import {
  getManagedComputerUsePythonPath,
  pauseComputerUseRuntimePreparation,
  refreshComputerUseRuntimeStatus,
  startComputerUseRuntimePreparation,
  subscribeComputerUseRuntimeStatus,
  type ComputerUseRuntimeStatus,
} from '../../utils/computerUse/runtimeManager.js'
import {
  readNativeScreenCapturePermission,
  requestNativeMacScreenRecordingPermission,
} from '../../utils/computerUse/nativeCapture.js'
// Embed helper scripts at compile time so they're available in bundled mode
// @ts-ignore — Bun text import
import MAC_HELPER_CONTENT from '../../../runtime/mac_helper.py' with { type: 'text' }
// @ts-ignore — Bun text import
import WIN_HELPER_CONTENT from '../../../runtime/win_helper.py' with { type: 'text' }
// @ts-ignore — Bun text import
import LINUX_HELPER_CONTENT from '../../../runtime/linux_helper.py' with { type: 'text' }
// @ts-ignore — Bun text import
import REQUIREMENTS_DARWIN from '../../../runtime/requirements.txt' with { type: 'text' }
// @ts-ignore — Bun text import
import REQUIREMENTS_WIN32 from '../../../runtime/requirements-win.txt' with { type: 'text' }
// @ts-ignore — Bun text import
import REQUIREMENTS_LINUX from '../../../runtime/requirements-linux.txt' with { type: 'text' }

const claudeHome = getClaudeConfigHomeDir()
const runtimeStateRoot = join(claudeHome, '.runtime')
const venvRoot = join(runtimeStateRoot, 'venv')
const installStampPath = join(runtimeStateRoot, 'requirements.sha256')

const isWindows = process.platform === 'win32'
const isLinux = process.platform === 'linux'
const REQUIREMENTS_CONTENT = isWindows
  ? REQUIREMENTS_WIN32
  : isLinux
    ? REQUIREMENTS_LINUX
    : REQUIREMENTS_DARWIN

function getPythonCommandEnv(): Record<string, string> | undefined {
  if (!isWindows) return undefined
  return {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  } as Record<string, string>
}

// 清华大学 PyPI 镜像，国内安装速度更快
const PIP_INDEX_URL = 'https://pypi.tuna.tsinghua.edu.cn/simple/'
const PIP_TRUSTED_HOST = 'pypi.tuna.tsinghua.edu.cn'

// Paths that resolve correctly in both dev and bundled modes
function getRequirementsPath(): string {
  return join(runtimeStateRoot, 'requirements.txt')
}

function getHelperFileName(): string {
  return isWindows
    ? 'win_helper.py'
    : isLinux
      ? 'linux_helper.py'
      : 'mac_helper.py'
}

function getHelperPath(): string {
  return join(runtimeStateRoot, getHelperFileName())
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

async function runCommand(
  cmd: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }> {
  try {
    const proc = Bun.spawn([cmd, ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: getPythonCommandEnv(),
    })
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const code = await proc.exited
    return { ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim(), code }
  } catch {
    return { ok: false, stdout: '', stderr: `Failed to run ${cmd}`, code: -1 }
  }
}

/** Materialize the embedded requirements and platform helper in user state. */
async function ensureRuntimeFiles(): Promise<void> {
  await mkdir(runtimeStateRoot, { recursive: true })

  // requirements.txt — always write from embedded constant (authoritative)
  await writeFile(getRequirementsPath(), REQUIREMENTS_CONTENT, 'utf8')

  // helper script — write the platform-appropriate version
  const helperContent = isWindows
    ? WIN_HELPER_CONTENT
    : isLinux
      ? LINUX_HELPER_CONTENT
      : MAC_HELPER_CONTENT
  await writeFile(getHelperPath(), helperContent, 'utf8')
}

// ============================================================================
// Runtime preparation progress → chat visibility
//
// First computer-use tool calls can block on a ~36MB runtime download while
// the chat UI only shows a spinner. Forward runtime phase changes to every
// connected desktop session as a system_notification so the user sees what
// the tool call is waiting on (and any failure reason).
// ============================================================================

const RUNTIME_NOTIFY_PROGRESS_STEP = 10
let lastRuntimeNotify: { phase: string; percent: number } | null = null

function broadcastRuntimeStatus(status: ComputerUseRuntimeStatus): void {
  const previous = lastRuntimeNotify
  const phaseChanged = !previous || previous.phase !== status.phase
  const progressAdvanced =
    status.phase === 'downloading' &&
    previous?.phase === 'downloading' &&
    status.progressPercent - previous.percent >= RUNTIME_NOTIFY_PROGRESS_STEP
  if (!phaseChanged && !progressAdvanced) return
  lastRuntimeNotify = { phase: status.phase, percent: status.progressPercent }

  for (const sessionId of getActiveSessionIds()) {
    sendToSession(sessionId, {
      type: 'system_notification',
      subtype: 'computer_use_runtime',
      data: {
        phase: status.phase,
        progressPercent: status.progressPercent,
        downloadedBytes: status.downloadedBytes,
        totalBytes: status.totalBytes,
        error: status.error,
      },
    })
  }
}

subscribeComputerUseRuntimeStatus(broadcastRuntimeStatus)

type EnvStatus = {
  platform: string
  supported: boolean
  runtime: ComputerUseRuntimeStatus
  python: {
    installed: boolean
    version: string | null
    path: string | null
  }
  venv: {
    created: boolean
    path: string
  }
  dependencies: {
    installed: boolean
    requirementsFound: boolean
  }
  permissions: {
    accessibility: boolean | null
    screenRecording: boolean | null
    inputAvailable: boolean | null
  }
}

async function checkStatus(): Promise<EnvStatus> {
  const platform = process.platform
  const managedRuntime = await refreshComputerUseRuntimeStatus()
  const supported =
    (platform === 'darwin' || platform === 'win32' || platform === 'linux') &&
    managedRuntime.platformKey !== null

  // Check venv — different paths on Windows vs Unix
  const venvPython = isWindows
    ? join(venvRoot, 'Scripts', 'python.exe')
    : join(venvRoot, 'bin', 'python3')
  const venvCreated = await pathExists(venvPython)

  // Existing users may already have the old per-user venv. Compare its stamp
  // with the embedded requirements without probing a system Python executable
  // on every 600 ms progress poll.
  let depsInstalled = false
  if (venvCreated) {
    try {
      const digest = createHash('sha256').update(REQUIREMENTS_CONTENT).digest('hex')
      const stamp = (await readFile(installStampPath, 'utf8')).trim()
      depsInstalled = stamp === digest
    } catch {
      depsInstalled = false
    }
  }

  const managedPython = managedRuntime.ready
    ? await getManagedComputerUsePythonPath()
    : null
  const legacyReady = venvCreated && depsInstalled
  const activePython = managedPython ?? (legacyReady ? venvPython : null)
  const activePythonVersion = activePython
    ? pythonRuntimeVersion(await runCommand(activePython, ['--version']))
    : null
  const runtime: ComputerUseRuntimeStatus = managedPython
    ? managedRuntime
    : legacyReady
      ? {
          ...managedRuntime,
          phase: 'ready',
          ready: true,
          version: activePythonVersion,
          source: 'legacy',
          downloadedBytes: 0,
          totalBytes: null,
          progressPercent: 100,
          error: null,
          canPause: false,
        }
      : managedRuntime

  // Check macOS permissions without triggering a system prompt. The helper
  // uses preflight + visible-window metadata as a passive fallback because
  // plain preflight can misreport child processes launched by the desktop app.
  let accessibility: boolean | null = null
  let screenRecording: boolean | null = null
  let inputAvailable: boolean | null = null
  if (supported && activePython) {
    try {
      await ensureRuntimeFiles()
    } catch (error) {
      // Helper materialization failing leaves every permission flag null.
      // Keep the status endpoint alive but record the cause.
      logForDebugging(
        `computer-use status: failed to write runtime helper files: ${error instanceof Error ? error.message : String(error)}`,
        { level: 'warn' },
      )
    }
    const helperPath = getHelperPath()
    if (await pathExists(helperPath)) {
      const permResult = await runCommand(activePython, [helperPath, 'check_permissions'])
      if (permResult.ok) {
        try {
          const parsed = JSON.parse(permResult.stdout)
          if (parsed.ok && parsed.result) {
            accessibility = parsed.result.accessibility ?? null
            screenRecording = parsed.result.screenRecording ?? null
            inputAvailable = parsed.result.inputAvailable ?? null
          }
        } catch {}
      }
    }
  }
  if (platform === 'darwin' || platform === 'linux') {
    const nativeScreenRecording = await readNativeScreenCapturePermission().catch(
      () => screenRecording,
    )
    if (nativeScreenRecording !== null) {
      screenRecording = nativeScreenRecording
    }
  }

  return {
    platform,
    supported,
    runtime,
    python: {
      installed: Boolean(activePython),
      version: activePythonVersion,
      path: activePython,
    },
    venv: { created: Boolean(activePython), path: managedPython ? path.dirname(managedPython) : venvRoot },
    dependencies: { installed: Boolean(activePython), requirementsFound: true },
    permissions: { accessibility, screenRecording, inputAvailable },
  }
}

function pythonRuntimeVersion(
  result: { ok: boolean; stdout: string; stderr: string },
): string | null {
  if (!result.ok) return null
  return `${result.stdout}\n${result.stderr}`.match(/Python\s+([^\s]+)/i)?.[1] ?? null
}

type SetupResult = {
  success: boolean
  steps: { name: string; ok: boolean; message: string }[]
}

async function runSetup(): Promise<SetupResult> {
  const steps: SetupResult['steps'] = []

  const venvPython = isWindows
    ? join(venvRoot, 'Scripts', 'python.exe')
    : join(venvRoot, 'bin', 'python3')
  const venvExists = await pathExists(venvPython)

  // Step 1: Check python
  const pythonRuntime = await detectPythonRuntime(
    process.platform,
    runCommand,
    venvExists ? venvPython : undefined,
  )
  if (!pythonRuntime.installed) {
    steps.push({
      name: 'python_check',
      ok: false,
      message: 'Python 3 未安装，请先安装 Python 3',
    })
    return { success: false, steps }
  }
  steps.push({
    name: 'python_check',
    ok: true,
    message: pythonRuntime.source === 'venv'
      ? `Python ${pythonRuntime.version}（使用现有虚拟环境）`
      : `Python ${pythonRuntime.version}`,
  })

  // Step 2: Extract runtime files to ~/.cyber/.runtime/
  try {
    await ensureRuntimeFiles()
    steps.push({ name: 'runtime_files', ok: true, message: '运行时文件已就绪' })
  } catch (err) {
    steps.push({
      name: 'runtime_files',
      ok: false,
      message: `提取运行时文件失败: ${err}`,
    })
    return { success: false, steps }
  }

  // Step 3: Create venv
  if (!venvExists) {
    if (!pythonRuntime.command) {
      steps.push({
        name: 'venv',
        ok: false,
        message: '未找到可用于创建虚拟环境的 Python 命令',
      })
      return { success: false, steps }
    }
    const venvResult = await runCommand(pythonRuntime.command, [
      ...pythonRuntime.prefixArgs,
      '-m',
      'venv',
      venvRoot,
    ])
    if (!venvResult.ok) {
      steps.push({
        name: 'venv',
        ok: false,
        message: `创建虚拟环境失败: ${venvResult.stderr}`,
      })
      return { success: false, steps }
    }
    steps.push({ name: 'venv', ok: true, message: '虚拟环境已创建' })
  } else {
    steps.push({ name: 'venv', ok: true, message: '虚拟环境已存在' })
  }

  // Step 4: Ensure pip
  const pipPath = isWindows
    ? join(venvRoot, 'Scripts', 'pip.exe')
    : join(venvRoot, 'bin', 'pip')
  if (!(await pathExists(pipPath))) {
    const pipResult = await runCommand(venvPython, [
      '-m',
      'ensurepip',
      '--upgrade',
    ])
    if (!pipResult.ok) {
      steps.push({
        name: 'pip',
        ok: false,
        message: `安装 pip 失败: ${pipResult.stderr}`,
      })
      return { success: false, steps }
    }
  }
  steps.push({ name: 'pip', ok: true, message: 'pip 已就绪' })

  // Step 5: Install requirements
  const reqPath = getRequirementsPath()
  const requirements = await readFile(reqPath, 'utf8')
  const digest = createHash('sha256').update(requirements).digest('hex')

  let installedDigest = ''
  try {
    installedDigest = (await readFile(installStampPath, 'utf8')).trim()
  } catch {}

  if (installedDigest !== digest) {
    // Upgrade pip first (using China mirror)
    await runCommand(venvPython, [
      '-m', 'pip', 'install', '--upgrade', 'pip',
      '-i', PIP_INDEX_URL, '--trusted-host', PIP_TRUSTED_HOST,
    ])

    // Install deps (using China mirror)
    const installResult = await runCommand(venvPython, [
      '-m', 'pip', 'install',
      '-r', reqPath,
      '-i', PIP_INDEX_URL, '--trusted-host', PIP_TRUSTED_HOST,
    ])
    if (!installResult.ok) {
      steps.push({
        name: 'deps',
        ok: false,
        message: `安装依赖失败: ${installResult.stderr.slice(0, 500)}`,
      })
      return { success: false, steps }
    }
    await writeFile(installStampPath, `${digest}\n`, 'utf8')
    steps.push({ name: 'deps', ok: true, message: '依赖已安装' })
  } else {
    steps.push({ name: 'deps', ok: true, message: '依赖已是最新' })
  }

  return { success: true, steps }
}

// ============================================================================
// Authorized Apps configuration — stored in ~/.cyber/cybercode/computer-use-config.json
// ============================================================================

const configPath = join(claudeHome, 'cybercode', 'computer-use-config.json')

type AuthorizedApp = {
  bundleId: string
  displayName: string
  authorizedAt: string
}

type ComputerUseConfig = {
  authorizedApps: AuthorizedApp[]
  grantFlags: {
    clipboardRead: boolean
    clipboardWrite: boolean
    systemKeyCombos: boolean
  }
}

type RequestAccessBody = {
  sessionId?: string
  request?: CuPermissionRequest
}

const DEFAULT_CONFIG: ComputerUseConfig = {
  authorizedApps: [],
  grantFlags: DEFAULT_DESKTOP_GRANT_FLAGS,
}

async function loadConfig(): Promise<ComputerUseConfig> {
  try {
    const raw = await readFile(configPath, 'utf8')
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

async function saveConfig(config: ComputerUseConfig): Promise<void> {
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8')
}

async function listInstalledApps(): Promise<{ bundleId: string; displayName: string; path: string }[]> {
  const helperPath = getHelperPath()
  const legacyPython = isWindows
    ? join(venvRoot, 'Scripts', 'python.exe')
    : join(venvRoot, 'bin', 'python3')
  const pythonBin = await getManagedComputerUsePythonPath()
    ?? ((await pathExists(legacyPython)) ? legacyPython : null)

  if (!pythonBin || !(await pathExists(helperPath))) {
    return []
  }

  const result = await runCommand(pythonBin, [helperPath, 'list_installed_apps'])
  if (!result.ok) return []

  try {
    const parsed = JSON.parse(result.stdout)
    return parsed.ok ? parsed.result : []
  } catch {
    return []
  }
}

// ============================================================================
// Route handler
// ============================================================================

export async function handleComputerUseApi(
  req: Request,
  _url: URL,
  segments: string[],
): Promise<Response> {
  const action = segments[2]

  if (action === 'status' && req.method === 'GET') {
    const status = await checkStatus()
    return Response.json(status)
  }

  if (action === 'setup' && req.method === 'POST') {
    const result = await runSetup()
    return Response.json(result)
  }

  if (action === 'runtime' && req.method === 'GET') {
    return Response.json((await checkStatus()).runtime)
  }

  if (action === 'runtime' && req.method === 'POST') {
    const current = await checkStatus()
    if (current.runtime.ready) return Response.json(current.runtime)
    const runtime = startComputerUseRuntimePreparation()
    return Response.json(runtime, { status: 202 })
  }

  if (action === 'runtime' && req.method === 'DELETE') {
    return Response.json(await pauseComputerUseRuntimePreparation())
  }

  // GET /api/computer-use/apps — list installed macOS apps
  if (action === 'apps' && req.method === 'GET') {
    const apps = await listInstalledApps()
    return Response.json({ apps })
  }

  // GET /api/computer-use/authorized-apps — current authorized app config
  if (action === 'authorized-apps' && req.method === 'GET') {
    const config = await loadConfig()
    return Response.json(config)
  }

  // PUT /api/computer-use/authorized-apps — update authorized apps
  if (action === 'authorized-apps' && req.method === 'PUT') {
    try {
      const body = (await req.json()) as Partial<ComputerUseConfig>
      const config = await loadConfig()
      if (body.authorizedApps) config.authorizedApps = body.authorizedApps
      if (body.grantFlags) config.grantFlags = { ...config.grantFlags, ...body.grantFlags }
      await saveConfig(config)
      return Response.json({ ok: true })
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 })
    }
  }

  // POST /api/computer-use/open-settings — open system settings pane
  if (action === 'open-settings' && req.method === 'POST') {
    const body = (await req.json().catch(() => ({}))) as { pane?: string }
    const pane = body.pane ?? 'Privacy_ScreenCapture'
    const allowed = ['Privacy_ScreenCapture', 'Privacy_Accessibility']
    if (!allowed.includes(pane)) {
      return Response.json({ error: 'Invalid pane' }, { status: 400 })
    }

    if (process.platform === 'darwin') {
      if (pane === 'Privacy_ScreenCapture') {
        await requestNativeMacScreenRecordingPermission().catch(() => null)
      }
      const url = `x-apple.systempreferences:com.apple.preference.security?${pane}`
      await runCommand('open', [url])
    } else if (process.platform === 'win32') {
      // Windows doesn't need privacy settings like macOS TCC, but we can
      // open the general privacy page if requested
      await runCommand('cmd', ['/c', 'start', 'ms-settings:privacy'])
    } else {
      return Response.json({ error: 'Unsupported platform' }, { status: 400 })
    }
    return Response.json({ ok: true })
  }

  if (action === 'request-access' && req.method === 'POST') {
    try {
      const body = (await req.json()) as RequestAccessBody
      if (!body.sessionId || !body.request?.requestId) {
        return Response.json(
          { error: 'BAD_REQUEST', message: 'sessionId and request are required' },
          { status: 400 },
        )
      }

      const response = await computerUseApprovalService.requestApproval(
        body.sessionId,
        body.request,
      )
      return Response.json(response)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Computer Use approval failed'
      const status = message.includes('not connected') ? 409 : 500
      return Response.json({ error: 'COMPUTER_USE_APPROVAL_FAILED', message }, { status })
    }
  }

  return Response.json(
    { error: 'NOT_FOUND', message: `Unknown computer-use action: ${action}` },
    { status: 404 },
  )
}
