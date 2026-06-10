import { constants } from 'fs'
import { copyFile, mkdir, writeFile } from 'fs/promises'
import { dirname } from 'path'
import * as React from 'react'
import type { CommandResultDisplay } from '../../commands.js'
import { Select, type OptionWithDescription } from '../../components/CustomSelect/index.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { MemoryFileSelector } from '../../components/memory/MemoryFileSelector.js'
import { getRelativeMemoryPath } from '../../components/memory/MemoryUpdateNotification.js'
import { Box, Link, Text } from '../../ink.js'
import {
  addPromptMemoryEntry,
  getPromptMemoryStatus,
  parsePromptMemoryTarget,
  readPromptMemoryFile,
  removePromptMemoryEntry,
  replacePromptMemoryEntry,
  type PromptMemoryTarget,
  writePromptMemoryFile,
} from '../../promptMemory/store.js'
import { readPromptMemoryAutoReviewLogs } from '../../promptMemory/autoReview.js'
import { ensurePromptMemorySeed } from '../../promptMemory/seed.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { clearMemoryFileCaches, getMemoryFiles } from '../../utils/claudemd.js'
import { getLegacyMemoryPathForPreferredPath } from '../../utils/config.js'
import { getErrnoCode } from '../../utils/errors.js'
import { getDisplayPath } from '../../utils/file.js'
import { logError } from '../../utils/log.js'
import { editFileInEditor } from '../../utils/promptEditor.js'

type MemorySelection = PromptMemoryTarget | 'instructions'

function getTargetLabel(target: PromptMemoryTarget): string {
  switch (target) {
    case 'soul':
      return 'SOUL.md'
    case 'brief':
      return 'BRIEF.md'
    case 'user':
      return 'USER.md'
  }
}

function formatStatusLine(target: PromptMemoryTarget): string {
  return getTargetLabel(target).padEnd(8)
}

async function ensureEditablePromptMemoryFile(
  target: PromptMemoryTarget,
): Promise<string> {
  await ensurePromptMemorySeed()
  const file = await readPromptMemoryFile(target, { seed: false })
  if (!file.exists && target !== 'soul') {
    await writePromptMemoryFile(target, '')
  }
  return file.path
}

async function openPromptMemoryFile(
  target: PromptMemoryTarget,
): Promise<string> {
  const filePath = await ensureEditablePromptMemoryFile(target)
  await editFileInEditor(filePath)
  return `Opened ${getTargetLabel(target)} at ${getDisplayPath(filePath)}`
}

async function copyLegacyInstructionMemoryIfNeeded(
  memoryPath: string,
): Promise<boolean> {
  const legacyPath = getLegacyMemoryPathForPreferredPath(memoryPath)
  if (!legacyPath) return false

  try {
    await copyFile(legacyPath, memoryPath, constants.COPYFILE_EXCL)
    return true
  } catch (error) {
    const code = getErrnoCode(error)
    if (code === 'ENOENT' || code === 'EEXIST') return false
    throw error
  }
}

async function ensureInstructionMemoryFile(memoryPath: string): Promise<void> {
  await mkdir(dirname(memoryPath), { recursive: true })
  const migratedLegacy = await copyLegacyInstructionMemoryIfNeeded(memoryPath)
  if (migratedLegacy) return

  try {
    await writeFile(memoryPath, '', {
      encoding: 'utf8',
      flag: 'wx',
    })
  } catch (error) {
    if (getErrnoCode(error) !== 'EEXIST') throw error
  }
}

async function formatPromptMemoryStatus(): Promise<string> {
  const status = await getPromptMemoryStatus()
  const lines = (['soul', 'brief', 'user'] as const).map(target => {
    const file = status.files[target]
    const entries =
      target === 'soul'
        ? ''
        : `, ${file.entries.length} ${file.entries.length === 1 ? 'entry' : 'entries'}`
    const limit = `${file.charCount}/${file.limit}`
    const over = file.overLimit ? ' over limit' : ''
    return `${formatStatusLine(target)} ${limit} chars${entries}${over}  ${getDisplayPath(file.path)}`
  })

  return `Prompt memory status:\n${lines.join('\n')}`
}

async function formatPromptMemoryLog(): Promise<string> {
  const logs = await readPromptMemoryAutoReviewLogs(20)
  if (logs.length === 0) {
    return 'No automatic prompt-memory updates recorded yet.'
  }

  const lines = logs.map(entry => {
    const timestamp = new Date(entry.timestamp).toLocaleString()
    const text =
      entry.content ?? entry.oldText ?? entry.message ?? 'Prompt memory updated.'
    return `${timestamp}  ${entry.trigger}  ${entry.action} ${entry.target}: ${text}`
  })

  return `Automatic prompt-memory updates:\n${lines.join('\n')}`
}

function parseReplaceArgs(raw: string): { oldText: string; content: string } | null {
  const separator = raw.includes('=>') ? '=>' : raw.includes('::') ? '::' : null
  if (!separator) return null
  const [oldText, ...rest] = raw.split(separator)
  return {
    oldText: oldText?.trim() ?? '',
    content: rest.join(separator).trim(),
  }
}

async function runPromptMemoryArgs(args: string): Promise<string | null> {
  const trimmed = args.trim()
  if (!trimmed) return null

  const [commandRaw, targetRaw, ...restParts] = trimmed.split(/\s+/)
  const command = commandRaw?.toLowerCase()
  const target = parsePromptMemoryTarget(targetRaw)
  const rest = restParts.join(' ').trim()

  if (command === 'status' || command === 'list') {
    return formatPromptMemoryStatus()
  }

  if (command === 'log' || command === 'logs') {
    return formatPromptMemoryLog()
  }

  if (command && parsePromptMemoryTarget(command)) {
    return openPromptMemoryFile(command as PromptMemoryTarget)
  }

  if (command === 'edit' || command === 'open') {
    if (!target) return 'Usage: /memory edit soul|brief|user'
    return openPromptMemoryFile(target)
  }

  if (command === 'write') {
    if (!target) return 'Usage: /memory write soul|brief|user <content>'
    const file = await writePromptMemoryFile(target, rest)
    return `Wrote ${getTargetLabel(target)} (${file.charCount}/${file.limit} chars). Changes apply to future conversations.`
  }

  if (command === 'add') {
    if (!target || target === 'soul') {
      return 'Usage: /memory add brief|user <entry>'
    }
    const result = await addPromptMemoryEntry(target, rest)
    return `${result.message} ${getTargetLabel(target)} now has ${result.entryCount} entries.`
  }

  if (command === 'remove' || command === 'forget') {
    if (!target || target === 'soul') {
      return 'Usage: /memory remove brief|user <text to match>'
    }
    const result = await removePromptMemoryEntry(target, rest)
    return `${result.message} ${getTargetLabel(target)} now has ${result.entryCount} entries.`
  }

  if (command === 'replace') {
    if (!target || target === 'soul') {
      return 'Usage: /memory replace brief|user <old text> => <new entry>'
    }
    const parsed = parseReplaceArgs(rest)
    if (!parsed) {
      return 'Usage: /memory replace brief|user <old text> => <new entry>'
    }
    const result = await replacePromptMemoryEntry(
      target,
      parsed.oldText,
      parsed.content,
    )
    return `${result.message} ${getTargetLabel(target)} now has ${result.entryCount} entries.`
  }

  return [
    'Usage:',
    '/memory status',
    '/memory log',
    '/memory edit soul|brief|user',
    '/memory add brief|user <entry>',
    '/memory remove brief|user <text to match>',
    '/memory replace brief|user <old text> => <new entry>',
    '/memory write soul|brief|user <content>',
  ].join('\n')
}

function PromptMemorySelector({
  onSelect,
  onCancel,
}: {
  onSelect: (selection: MemorySelection) => void
  onCancel: () => void
}): React.ReactNode {
  const options: OptionWithDescription<MemorySelection>[] = [
    {
      label: 'SOUL.md',
      value: 'soul',
      description: 'Agent identity and tone',
    },
    {
      label: 'BRIEF.md',
      value: 'brief',
      description: 'Stable agent facts and working notes',
    },
    {
      label: 'USER.md',
      value: 'user',
      description: 'User preferences and communication style',
    },
    {
      label: 'Instruction memory files',
      value: 'instructions',
      description: 'CYBER.md, project rules, and auto-memory folders',
    },
  ]

  return (
    <Select
      options={options}
      onChange={onSelect}
      onCancel={onCancel}
      defaultFocusValue="brief"
    />
  )
}

function MemoryCommand({
  onDone,
}: {
  onDone: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void
}): React.ReactNode {
  const [mode, setMode] = React.useState<'prompt' | 'instructions'>('prompt')

  const handlePromptSelect = async (selection: MemorySelection) => {
    if (selection === 'instructions') {
      setMode('instructions')
      return
    }

    try {
      const message = await openPromptMemoryFile(selection)
      onDone(`${message}\n\n> Changes apply to future conversations.`, {
        display: 'system',
      })
    } catch (error) {
      logError(error)
      onDone(`Error opening prompt memory file: ${error}`)
    }
  }

  const handleSelectInstructionMemoryFile = async (memoryPath: string) => {
    try {
      await ensureInstructionMemoryFile(memoryPath)
      await editFileInEditor(memoryPath)
      onDone(`Opened memory file at ${getRelativeMemoryPath(memoryPath)}`, {
        display: 'system',
      })
    } catch (error) {
      logError(error)
      onDone(`Error opening memory file: ${error}`)
    }
  }

  const handleCancel = () => {
    onDone('Cancelled memory editing', { display: 'system' })
  }

  return (
    <Dialog title="Memory" onCancel={handleCancel} color="remember">
      <Box flexDirection="column">
        {mode === 'prompt' ? (
          <PromptMemorySelector
            onSelect={handlePromptSelect}
            onCancel={handleCancel}
          />
        ) : (
          <React.Suspense fallback={null}>
            <MemoryFileSelector
              onSelect={handleSelectInstructionMemoryFile}
              onCancel={handleCancel}
            />
          </React.Suspense>
        )}

        <Box marginTop={1}>
          <Text dimColor>
            Prompt memory: SOUL.md, BRIEF.md, USER.md. Learn more:{' '}
            <Link url="https://code.claude.com/docs/en/memory" />
          </Text>
        </Box>
      </Box>
    </Dialog>
  )
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  try {
    const result = await runPromptMemoryArgs(args)
    if (result !== null) {
      onDone(result, { display: 'system' })
      return null
    }
  } catch (error) {
    if (getErrnoCode(error) !== undefined) {
      logError(error)
    }
    onDone(`Memory command failed: ${error}`, { display: 'system' })
    return null
  }

  clearMemoryFileCaches()
  await getMemoryFiles()
  return <MemoryCommand onDone={onDone} />
}
