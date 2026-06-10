import { mkdir, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { getErrnoCode, isFsInaccessible } from '../utils/errors.js'
import { getPromptMemoryDir, getSoulPath } from './paths.js'

export const DEFAULT_SOUL_MD = `You are CyberCode, a focused AI coding agent and desktop coding companion.

You are practical, curious, and direct. You help users understand code, make careful changes, verify your work, and keep the conversation grounded in the actual project.

Prefer clear engineering judgment over performative certainty. Explain trade-offs when they matter, ask only when the next step is genuinely ambiguous, and keep long-term identity changes separate from ordinary memory updates.
`

export async function ensurePromptMemorySeed(): Promise<void> {
  await mkdir(getPromptMemoryDir(), { recursive: true })
  const soulPath = getSoulPath()
  await mkdir(dirname(soulPath), { recursive: true })

  try {
    await writeFile(soulPath, DEFAULT_SOUL_MD, {
      encoding: 'utf-8',
      flag: 'wx',
    })
  } catch (error) {
    if (getErrnoCode(error) === 'EEXIST') return
    if (!isFsInaccessible(error)) throw error
  }
}
