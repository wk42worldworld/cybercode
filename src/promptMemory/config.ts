import { randomBytes } from 'crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { getPromptMemoryConfigPath } from './paths.js'

export type PromptMemoryConfig = {
  version: 1
  injectEvolutionMemory: boolean
  updatedAt?: string
}

export const DEFAULT_PROMPT_MEMORY_CONFIG: PromptMemoryConfig = {
  version: 1,
  injectEvolutionMemory: true,
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}`
  await writeFile(tmpPath, content, { encoding: 'utf-8', mode: 0o600 })
  try {
    await rename(tmpPath, filePath)
    await chmod(filePath, 0o600).catch(() => {})
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => {})
    throw error
  }
}

export async function readPromptMemoryConfig(): Promise<PromptMemoryConfig> {
  try {
    const stored = JSON.parse(
      await readFile(getPromptMemoryConfigPath(), 'utf-8'),
    ) as Partial<PromptMemoryConfig>
    return {
      ...DEFAULT_PROMPT_MEMORY_CONFIG,
      ...(typeof stored.injectEvolutionMemory === 'boolean'
        ? { injectEvolutionMemory: stored.injectEvolutionMemory }
        : {}),
      version: 1,
      ...(typeof stored.updatedAt === 'string'
        ? { updatedAt: stored.updatedAt }
        : {}),
    }
  } catch {
    return { ...DEFAULT_PROMPT_MEMORY_CONFIG }
  }
}

export async function updatePromptMemoryConfig(
  input: Pick<PromptMemoryConfig, 'injectEvolutionMemory'>,
): Promise<PromptMemoryConfig> {
  const next: PromptMemoryConfig = {
    version: 1,
    injectEvolutionMemory: input.injectEvolutionMemory,
    updatedAt: new Date().toISOString(),
  }
  await atomicWrite(
    getPromptMemoryConfigPath(),
    `${JSON.stringify(next, null, 2)}\n`,
  )
  return next
}
