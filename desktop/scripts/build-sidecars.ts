import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { prepareLinuxSidecarPackage } from './linuxSidecarPackaging'
import { detectHostTriple, mapTargetTripleToBun } from './sidecarTarget'

const desktopRoot = path.resolve(import.meta.dir, '..')
const repoRoot = path.resolve(desktopRoot, '..')
const binariesDir = path.join(desktopRoot, 'src-tauri', 'binaries')
const sidecarResourcesDir = path.join(
  desktopRoot,
  'src-tauri',
  'resources',
  'sidecar',
)

const targetTriple =
  process.env.TAURI_ENV_TARGET_TRIPLE ||
  process.env.CARGO_BUILD_TARGET ||
  (await detectHostTriple(repoRoot))

const bunTarget = mapTargetTripleToBun(targetTriple)

await mkdir(binariesDir, { recursive: true })
await mkdir(sidecarResourcesDir, { recursive: true })
await Promise.all([
  rm(path.join(sidecarResourcesDir, 'cybercode-sidecar.body'), { force: true }),
  rm(path.join(sidecarResourcesDir, 'manifest.json'), { force: true }),
])

console.log('[build-sidecars] preparing native Computer Use helper...')
const computerUseHelperPrepareProc = Bun.spawn(
  ['bun', 'run', path.join(desktopRoot, 'scripts/prepare-computer-use-helper.ts')],
  {
    cwd: repoRoot,
    env: { ...process.env, TAURI_ENV_TARGET_TRIPLE: targetTriple },
    stdout: 'inherit',
    stderr: 'inherit',
  },
)
const computerUseHelperPrepareExit = await computerUseHelperPrepareProc.exited
if (computerUseHelperPrepareExit !== 0) {
  throw new Error(
    `[build-sidecars] prepare-computer-use-helper failed (exit ${computerUseHelperPrepareExit})`,
  )
}

console.log('[build-sidecars] preparing embedded Computer Use runtime...')
const computerUseRuntimePrepareProc = Bun.spawn(
  ['bun', 'run', path.join(desktopRoot, 'scripts/prepare-computer-use-runtime.ts')],
  {
    cwd: repoRoot,
    env: { ...process.env, TAURI_ENV_TARGET_TRIPLE: targetTriple },
    stdout: 'inherit',
    stderr: 'inherit',
  },
)
const computerUseRuntimePrepareExit = await computerUseRuntimePrepareProc.exited
if (computerUseRuntimePrepareExit !== 0) {
  throw new Error(
    `[build-sidecars] prepare-computer-use-runtime failed (exit ${computerUseRuntimePrepareExit})`,
  )
}

console.log('[build-sidecars] preparing embedded RTK runtime...')
const rtkPrepareProc = Bun.spawn(
  ['bun', 'run', path.join(desktopRoot, 'scripts/prepare-rtk.ts')],
  {
    cwd: repoRoot,
    env: { ...process.env, TAURI_ENV_TARGET_TRIPLE: targetTriple },
    stdout: 'inherit',
    stderr: 'inherit',
  },
)
const rtkPrepareExit = await rtkPrepareProc.exited
if (rtkPrepareExit !== 0) {
  throw new Error(`[build-sidecars] prepare-rtk failed (exit ${rtkPrepareExit})`)
}

console.log('[build-sidecars] preparing embedded agent-browser runtime...')
const agentBrowserPrepareProc = Bun.spawn(
  ['bun', 'run', path.join(desktopRoot, 'scripts/prepare-agent-browser.ts')],
  {
    cwd: repoRoot,
    env: { ...process.env, TAURI_ENV_TARGET_TRIPLE: targetTriple },
    stdout: 'inherit',
    stderr: 'inherit',
  },
)
const agentBrowserPrepareExit = await agentBrowserPrepareProc.exited
if (agentBrowserPrepareExit !== 0) {
  throw new Error(
    `[build-sidecars] prepare-agent-browser failed (exit ${agentBrowserPrepareExit})`,
  )
}

console.log('[build-sidecars] preparing embedded CodeGraph core...')
const codeGraphPrepareProc = Bun.spawn(
  ['bun', 'run', path.join(desktopRoot, 'scripts/prepare-codegraph.ts')],
  {
    cwd: repoRoot,
    env: { ...process.env, TAURI_ENV_TARGET_TRIPLE: targetTriple },
    stdout: 'inherit',
    stderr: 'inherit',
  },
)
const codeGraphPrepareExit = await codeGraphPrepareProc.exited
if (codeGraphPrepareExit !== 0) {
  throw new Error(`[build-sidecars] prepare-codegraph failed (exit ${codeGraphPrepareExit})`)
}

// 编译前扫一遍 src/ 把缺失的 ant-internal 模块在磁盘上 stub 出来。
// CodeGraph 的平台桥接要先生成，避免被扫描器当成缺失模块。
console.log('[build-sidecars] scanning for missing imports...')
const scanProc = Bun.spawn(
  ['bun', 'run', path.join(desktopRoot, 'scripts/scan-missing-imports.ts')],
  { cwd: repoRoot, stdout: 'inherit', stderr: 'inherit' },
)
const scanExit = await scanProc.exited
if (scanExit !== 0) {
  throw new Error(`[build-sidecars] scan-missing-imports failed (exit ${scanExit})`)
}

// 单一合并 sidecar：server / cli 共享一份 bun runtime + 共享依赖代码。
// 调用方（Tauri lib.rs / conversationService）通过第一个 positional 参数
// 选择 'server' 或 'cli' 模式，详见 desktop/sidecars/cybercode-sidecar.ts。
const sidecarOutfileBase = path.join(
  binariesDir,
  `cybercode-sidecar-${targetTriple}`,
)
if (targetTriple.includes('-linux-')) {
  // linuxdeploy 会向 Bun 的静态 ELF 写入 RPATH，随后 GTK 插件再次执行
  // ldd 时崩溃。仅把 4 字节 ELF 头拆出，首启时由轻量 shell launcher
  // 校验并恢复，既保留无感安装，也让 AppImage 打包器不会改写真实二进制。
  const temporaryBuildDir = await mkdtemp(
    path.join(tmpdir(), 'cybercode-sidecar-build-'),
  )
  try {
    const compiledSidecar = await compileExecutable({
      entrypoint: path.join(desktopRoot, 'sidecars/cybercode-sidecar.ts'),
      outfileBase: path.join(temporaryBuildDir, 'cybercode-sidecar'),
      productName: 'CyberCode Sidecar',
      bunTarget,
    })
    const manifest = await prepareLinuxSidecarPackage({
      executablePath: compiledSidecar,
      launcherPath: sidecarOutfileBase,
      resourceDir: sidecarResourcesDir,
      targetTriple,
    })
    console.log(
      `[build-sidecars] Linux sidecar launcher -> ${sidecarOutfileBase} (${manifest.executableSha256.slice(0, 12)})`,
    )
  } finally {
    await rm(temporaryBuildDir, { recursive: true, force: true })
  }
} else {
  await compileExecutable({
    entrypoint: path.join(desktopRoot, 'sidecars/cybercode-sidecar.ts'),
    outfileBase: sidecarOutfileBase,
    productName: 'CyberCode Sidecar',
    bunTarget,
  })
  await writeFile(
    path.join(sidecarResourcesDir, 'manifest.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        name: 'cybercode-sidecar',
        format: 'direct-executable-v1',
        targetTriple,
      },
      null,
      2,
    )}\n`,
  )
}

console.log(`[build-sidecars] Built desktop sidecar for ${targetTriple} (${bunTarget})`)

async function compileExecutable({
  entrypoint,
  outfileBase,
  productName,
  bunTarget,
}: {
  entrypoint: string
  outfileBase: string
  productName: string
  bunTarget: string
}): Promise<string> {
  const result = await Bun.build({
    entrypoints: [entrypoint],
    // minify whitespace + identifiers + dead-code 大概能省 5-15% 的二进制大小，
    // 代价是 stack trace 里的函数名变成短名 —— 终端用户场景可接受。
    minify: { whitespace: true, identifiers: true, syntax: true },
    sourcemap: 'none',
    target: 'bun',
    define: {
      // The public signaling endpoint is product infrastructure, not a user
      // setting. Runtime CYBERCODE_P2P_SIGNAL_URL still takes precedence.
      'process.env.CYBERCODE_P2P_BUILTIN_SIGNAL_URL': JSON.stringify(
        process.env.CYBERCODE_P2P_BUILTIN_SIGNAL_URL?.trim() || '',
      ),
    },
    // 可选 npm 包：开 telemetry / 用 sharp 图像 / 用 Bedrock/Vertex 等
    // 替代 provider 时才需要，全部不在顶层 package.json 里。标 external
    // 让 bun build 跳过解析；运行时 import 在没装时自然失败，由 try/catch
    // 或 feature() gate 兜底。
    external: [
      // OpenTelemetry exporters（开 OTEL_* env 时才加载）
      '@opentelemetry/exporter-trace-otlp-grpc',
      '@opentelemetry/exporter-trace-otlp-http',
      '@opentelemetry/exporter-trace-otlp-proto',
      '@opentelemetry/exporter-logs-otlp-grpc',
      '@opentelemetry/exporter-logs-otlp-http',
      '@opentelemetry/exporter-logs-otlp-proto',
      '@opentelemetry/exporter-metrics-otlp-grpc',
      '@opentelemetry/exporter-metrics-otlp-http',
      '@opentelemetry/exporter-metrics-otlp-proto',
      '@opentelemetry/exporter-prometheus',
      // 替代 LLM provider —— 默认不用，用户自装
      '@aws-sdk/client-bedrock',
      '@aws-sdk/client-sts',
      '@anthropic-ai/bedrock-sdk',
      '@anthropic-ai/foundry-sdk',
      '@anthropic-ai/vertex-sdk',
      '@azure/identity',
      // ant-internal / 可选工具
      '@anthropic-ai/mcpb',
      'fflate',
      'sharp',
      'react-devtools-core',
    ],
    compile: {
      target: bunTarget,
      outfile: outfileBase,
      autoloadTsconfig: true,
      autoloadPackageJson: true,
      windows: {
        title: productName,
        publisher: 'CyberCode',
        description: productName,
        hideConsole: true,
      },
    },
  })

  if (!result.success) {
    const logs = result.logs.map((log) => log.message).join('\n')
    throw new Error(`[build-sidecars] Failed to compile ${productName}:\n${logs}`)
  }

  const outputPath = result.outputs[0]?.path ?? outfileBase
  console.log(`[build-sidecars] ${productName} -> ${outputPath}`)

  // macOS Apple System Policy (ASP) requires valid code signatures on all
  // executables. Bun-compiled binaries ship with an invalid/empty signature
  // that causes "load code signature error 4" and SIGKILL at launch.
  // Fix: strip the broken signature, then ad-hoc sign.
  if (process.platform === 'darwin') {
    await adHocSignMacBinary(outputPath)
  }

  return outputPath
}

async function adHocSignMacBinary(outputPath: string) {
  console.log(`[build-sidecars] ad-hoc signing ${outputPath} for macOS ...`)
  const strip = Bun.spawn(['codesign', '--remove-signature', outputPath], {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  await strip.exited

  const sign = Bun.spawn(
    ['codesign', '--sign', '-', '--force', '--timestamp=none', outputPath],
    { stdout: 'inherit', stderr: 'inherit' },
  )
  const signExit = await sign.exited
  if (signExit !== 0) {
    throw new Error(`[build-sidecars] ad-hoc codesign failed for ${outputPath} (exit ${signExit})`)
  }
  console.log(`[build-sidecars] ad-hoc signed ${outputPath}`)
}
