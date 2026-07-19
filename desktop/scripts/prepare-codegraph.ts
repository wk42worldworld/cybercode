import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'

const CODEGRAPH_VERSION = '1.4.1'
const desktopRoot = path.resolve(import.meta.dir, '..')
const repoRoot = path.resolve(desktopRoot, '..')
const generatedDir = path.join(desktopRoot, 'sidecars', 'generated')
const resourceDir = path.join(desktopRoot, 'src-tauri', 'resources', 'codegraph')
const targetTriple =
  process.env.TAURI_ENV_TARGET_TRIPLE ||
  process.env.CARGO_BUILD_TARGET ||
  (await detectHostTriple())
const platformPackage = platformPackageForTriple(targetTriple)
const require = createRequire(path.join(desktopRoot, 'package.json'))
const platformRoot = path.dirname(require.resolve(`${platformPackage}/package.json`))
const libraryRoot = path.join(platformRoot, 'lib')

const bundledGrammars = [
  'tree-sitter-typescript.wasm',
  'tree-sitter-tsx.wasm',
  'tree-sitter-javascript.wasm',
  'tree-sitter-python.wasm',
  'tree-sitter-go.wasm',
  'tree-sitter-rust.wasm',
  'tree-sitter-java.wasm',
  'tree-sitter-c.wasm',
  'tree-sitter-php.wasm',
  'tree-sitter-lua.wasm',
  'tree-sitter-solidity.wasm',
] as const

await patchSqliteAdapter()
await patchCheckpointWorkers()
await patchSchemaResolver()
await patchParsePool()
await patchGrammarResolver()
await prepareRuntimeModule()
await prepareGrammarResources()

console.log(
  `[prepare-codegraph] CodeGraph ${CODEGRAPH_VERSION} core prepared for ${targetTriple} ` +
    `(${bundledGrammars.length} bundled grammars)`,
)

async function patchSqliteAdapter() {
  const filePath = path.join(libraryRoot, 'dist', 'db', 'sqlite-adapter.js')
  let source = await readFile(filePath, 'utf8')
  if (source.includes("require('bun:sqlite')")) return

  source = replaceRequired(
    source,
    "const { DatabaseSync } = require('node:sqlite');\n        this._db = new DatabaseSync(dbPath);",
    "const { Database } = require('bun:sqlite');\n        this._db = new Database(dbPath, { create: true });\n        this._open = true;",
    filePath,
  )
  source = replaceRequired(source, 'return this._db.isOpen;', 'return this._open;', filePath)
  source = replaceRequired(
    source,
    'if (this._db.isOpen)\n            this._db.close();',
    'if (this._open) {\n            this._db.close();\n            this._open = false;\n        }',
    filePath,
  )
  source = replaceRequired(
    source,
    'const stmt = this._db.prepare(sql);\n        return {',
    `const stmt = this._db.prepare(sql);
        // Bun requires named bindings to retain their @/$/: prefix, while
        // node:sqlite accepts bare object keys. Normalize only named objects.
        const named = new Map(Array.from(
            sql.matchAll(/([@:$])([A-Za-z_][A-Za-z0-9_]*)/g),
            (match) => [match[2], match[1] + match[2]],
        ));
        const bind = (params) => {
            if (params.length !== 1 || !params[0] || Array.isArray(params[0]) || typeof params[0] !== 'object') return params;
            const output = {};
            for (const [key, value] of Object.entries(params[0])) output[named.get(key) || key] = value;
            return [output];
        };
        return {`,
    filePath,
  )
  source = source
    .replace('const r = stmt.run(...params);', 'const r = stmt.run(...bind(params));')
    .replace('return stmt.get(...params);', 'return stmt.get(...bind(params));')
    .replace('return stmt.all(...params);', 'return stmt.all(...bind(params));')
    .replace('return stmt.iterate(...params);', 'return stmt.iterate(...bind(params));')
  await writeFile(filePath, source)
}

async function patchCheckpointWorkers() {
  const filePath = path.join(libraryRoot, 'dist', 'db', 'index.js')
  let source = await readFile(filePath, 'utf8')
  const nodeWorker = `const { DatabaseSync } = require('node:sqlite');
          const db = new DatabaseSync(workerData.dbPath);`
  const bunWorker = `const { Database } = require('bun:sqlite');
          const db = new Database(workerData.dbPath);`

  if (source.includes(nodeWorker)) {
    source = source.replaceAll(nodeWorker, bunWorker)
    await writeFile(filePath, source)
    return
  }
  if (!source.includes("require('bun:sqlite')")) {
    throw new Error(`[prepare-codegraph] Unable to patch WAL checkpoint workers: ${filePath}`)
  }
}

async function patchSchemaResolver() {
  const filePath = path.join(libraryRoot, 'dist', 'db', 'index.js')
  let source = await readFile(filePath, 'utf8')
  if (source.includes("process.env.CYBER_CODEGRAPH_ASSET_DIR || __dirname, 'schema.sql'")) {
    return
  }

  source = replaceRequired(
    source,
    "const schemaPath = path.join(__dirname, 'schema.sql');",
    "const schemaPath = path.join(process.env.CYBER_CODEGRAPH_ASSET_DIR || __dirname, 'schema.sql');",
    filePath,
  )
  await writeFile(filePath, source)
}

async function patchParsePool() {
  const filePath = path.join(libraryRoot, 'dist', 'extraction', 'parse-pool.js')
  const extractionModulePath = path
    .relative(
      path.dirname(filePath),
      path.join(desktopRoot, 'sidecars', 'htmlScriptExtraction.ts'),
    )
    .replaceAll('\\', '/')
  const extractionModule = extractionModulePath.startsWith('.')
    ? extractionModulePath
    : `./${extractionModulePath}`
  const source = String.raw`"use strict";
// CyberCode runs indexing in its own sidecar mode. Parsing in-process avoids
// shipping a second JavaScript worker tree while keeping the desktop server UI
// responsive in its separate process.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParseWorkerPool = void 0;
exports.resolveParseTimeoutMs = resolveParseTimeoutMs;
exports.resolveParsePoolSize = resolveParsePoolSize;
const treeSitter = require("./tree-sitter");
const grammars = require("./grammars");
const { extractHtmlJavaScript, isHtmlFile } = require(${JSON.stringify(extractionModule)});
function resolveParseTimeoutMs(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 10000;
}
function resolveParsePoolSize() { return 1; }
class ParseWorkerPool {
    constructor(options) {
        this.ready = grammars.loadGrammarsForLanguages(options.languages, options.grammarBuffers);
    }
    get size() { return 1; }
    get liveWorkers() { return 1; }
    get healthy() { return true; }
    async requestParse(task) {
        await this.ready;
        const content = isHtmlFile(task.filePath)
            ? extractHtmlJavaScript(task.content)
            : task.content;
        return treeSitter.extractFromSource(
            task.filePath,
            content,
            task.language,
            task.frameworkNames,
        );
    }
    recycleAll() {}
    async destroy() {}
}
exports.ParseWorkerPool = ParseWorkerPool;
`
  await writeFile(filePath, source)
}

async function patchGrammarResolver() {
  const filePath = path.join(libraryRoot, 'dist', 'extraction', 'grammars.js')
  let source = await readFile(filePath, 'utf8')
  let changed = false

  if (!source.includes('CYBER_CODEGRAPH_ASSET_DIR')) {
    source = replaceRequired(
      source,
      'await web_tree_sitter_1.Parser.init();',
      `await web_tree_sitter_1.Parser.init({
        locateFile: (name) => path.join(
            process.env.CYBER_CODEGRAPH_ASSET_DIR || __dirname,
            name,
        ),
    });`,
      filePath,
    )
    const resolverStart = source.indexOf('function resolveWasmPath(lang) {')
    const resolverEnd = source.indexOf('\n}', resolverStart) + 2
    if (resolverStart < 0 || resolverEnd < 2) {
      throw new Error(`[prepare-codegraph] Unable to patch grammar resolver: ${filePath}`)
    }
    source =
      source.slice(0, resolverStart) +
      `function resolveWasmPath(lang) {
    const wasmFile = WASM_GRAMMAR_FILES[lang];
    return path.join(process.env.CYBER_CODEGRAPH_ASSET_DIR || __dirname, wasmFile);
}` +
      source.slice(resolverEnd)
    changed = true
  }

  if (!source.includes('CyberCode: index JavaScript embedded in standalone HTML files.')) {
    source = replaceRequired(
      source,
      "    '.jsx': 'jsx',",
      `    '.jsx': 'jsx',
    // CyberCode: index JavaScript embedded in standalone HTML files.
    '.html': 'javascript',
    '.htm': 'javascript',`,
      filePath,
    )
    changed = true
  }

  if (changed) await writeFile(filePath, source)
}

async function prepareRuntimeModule() {
  await mkdir(generatedDir, { recursive: true })
  const source = `// Generated by scripts/prepare-codegraph.ts. Do not edit.
export {
  CodeGraph,
  setLogger,
  silentLogger,
} from '${platformPackage}/lib/dist/index.js'
`
  await writeFile(path.join(generatedDir, 'codegraph-runtime.ts'), source)
}

async function prepareGrammarResources() {
  await mkdir(resourceDir, { recursive: true })
  for (const entry of await readdir(resourceDir)) {
    if (entry.endsWith('.wasm') || entry === 'schema.sql' || entry === 'manifest.json') {
      await rm(path.join(resourceDir, entry), { force: true })
    }
  }

  const schemaDestination = path.join(resourceDir, 'schema.sql')
  await copyFile(
    path.join(libraryRoot, 'dist', 'db', 'schema.sql'),
    schemaDestination,
  )
  const schemaBytes = await readFile(schemaDestination)

  await copyFile(
    path.join(libraryRoot, 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm'),
    path.join(resourceDir, 'tree-sitter.wasm'),
  )

  const treeSitterWasmsDir = path.join(libraryRoot, 'node_modules', 'tree-sitter-wasms', 'out')
  const vendoredWasmsDir = path.join(libraryRoot, 'dist', 'extraction', 'wasm')
  const assets: Array<{ name: string; sha256: string }> = []
  for (const grammar of bundledGrammars) {
    const preferred = grammar === 'tree-sitter-lua.wasm'
      ? path.join(vendoredWasmsDir, grammar)
      : path.join(treeSitterWasmsDir, grammar)
    const destination = path.join(resourceDir, grammar)
    await copyFile(preferred, destination)
    const bytes = await readFile(destination)
    assets.push({ name: grammar, sha256: createHash('sha256').update(bytes).digest('hex') })
  }

  await writeFile(
    path.join(resourceDir, 'manifest.json'),
    JSON.stringify(
      {
        codeGraphVersion: CODEGRAPH_VERSION,
        targetTriple,
        schema: {
          name: 'schema.sql',
          sha256: createHash('sha256').update(schemaBytes).digest('hex'),
        },
        grammars: assets,
      },
      null,
      2,
    ) + '\n',
  )
}

function replaceRequired(source: string, search: string, replacement: string, filePath: string) {
  if (!source.includes(search)) {
    throw new Error(`[prepare-codegraph] Expected source fragment missing in ${filePath}`)
  }
  return source.replace(search, replacement)
}

function platformPackageForTriple(triple: string) {
  switch (triple) {
    case 'aarch64-apple-darwin':
      return '@colbymchenry/codegraph-darwin-arm64'
    case 'x86_64-apple-darwin':
      return '@colbymchenry/codegraph-darwin-x64'
    case 'x86_64-unknown-linux-gnu':
    case 'x86_64-unknown-linux-musl':
      return '@colbymchenry/codegraph-linux-x64'
    case 'aarch64-unknown-linux-gnu':
    case 'aarch64-unknown-linux-musl':
      return '@colbymchenry/codegraph-linux-arm64'
    case 'x86_64-pc-windows-msvc':
      return '@colbymchenry/codegraph-win32-x64'
    case 'aarch64-pc-windows-msvc':
      return '@colbymchenry/codegraph-win32-arm64'
    default:
      throw new Error(`[prepare-codegraph] Unsupported target triple: ${triple}`)
  }
}

async function detectHostTriple() {
  const process = Bun.spawn(['rustc', '-vV'], { stdout: 'pipe', stderr: 'pipe' })
  const stdout = await new Response(process.stdout).text()
  const stderr = await new Response(process.stderr).text()
  const exitCode = await process.exited
  if (exitCode !== 0) throw new Error(`rustc -vV failed: ${stderr || stdout}`)
  const hostLine = stdout.split('\n').find((line) => line.startsWith('host: '))
  if (!hostLine) throw new Error('Could not detect Rust host triple')
  return hostLine.slice('host: '.length).trim()
}
