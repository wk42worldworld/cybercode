import { readFile } from 'fs/promises'
import { getSessionId } from '../bootstrap/state.js'
import { logForDebugging } from '../utils/debug.js'
import { isFsInaccessible } from '../utils/errors.js'
import {
  SOUL_CHAR_LIMIT,
  boundPromptMemoryPair,
  boundPromptMemoryText,
} from './budget.js'
import { readPromptMemoryConfig } from './config.js'
import {
  getBriefPath,
  getSoulPath,
  getUserPromptMemoryPath,
} from './paths.js'
import { ensurePromptMemorySeed } from './seed.js'

type PromptMemorySnapshot = {
  sessionId: string
  value: string | null
}

let cachedSnapshot: PromptMemorySnapshot | null = null

async function readOptionalText(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf-8')
  } catch (error) {
    if (!isFsInaccessible(error)) {
      logForDebugging(`[prompt-memory] failed to read ${filePath}: ${error}`, {
        level: 'debug',
      })
    }
    return ''
  }
}

export async function buildPromptMemorySnapshot(): Promise<string | null> {
  try {
    await ensurePromptMemorySeed()
  } catch (error) {
    logForDebugging(`[prompt-memory] failed to seed prompt memory: ${error}`, {
      level: 'debug',
    })
  }

  const [config, soulRaw, briefRaw, userRaw] = await Promise.all([
    readPromptMemoryConfig(),
    readOptionalText(getSoulPath()),
    readOptionalText(getBriefPath()),
    readOptionalText(getUserPromptMemoryPath()),
  ])

  const soul = boundPromptMemoryText('SOUL.md', soulRaw, SOUL_CHAR_LIMIT)
  const { brief, user } = boundPromptMemoryPair({
    brief: briefRaw,
    user: userRaw,
  })

  const sections: string[] = []

  if (soul.content) {
    sections.push(`# CyberCode Soul\n\n${soul.content}`)
  }

  const promptMemoryBlocks: string[] = []
  if (config.injectEvolutionMemory && brief.content) {
    promptMemoryBlocks.push(`## Brief\n\n${brief.content}`)
  }
  if (config.injectEvolutionMemory && user.content) {
    promptMemoryBlocks.push(`## User\n\n${user.content}`)
  }

  if (promptMemoryBlocks.length > 0) {
    sections.push(
      [
        '# Prompt Memory',
        '',
        'These files were loaded once at conversation start as a frozen snapshot. Changes made during this conversation apply only to future conversations.',
        '',
        ...promptMemoryBlocks,
      ].join('\n'),
    )
  }

  return sections.length > 0 ? sections.join('\n\n') : null
}

export async function loadPromptMemory(): Promise<string | null> {
  const sessionId = getSessionId()
  if (cachedSnapshot?.sessionId === sessionId) {
    return cachedSnapshot.value
  }

  const value = await buildPromptMemorySnapshot()
  cachedSnapshot = { sessionId, value }
  return value
}

export function clearPromptMemorySnapshotForTesting(): void {
  cachedSnapshot = null
}
