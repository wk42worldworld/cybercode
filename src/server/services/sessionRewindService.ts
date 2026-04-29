import type { UUID } from 'crypto'
import { chmod, copyFile, mkdir, readFile, stat, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { diffLines } from 'diff'
import { ApiError } from '../middleware/errorHandler.js'
import {
  type FileHistorySnapshot,
} from '../../utils/fileHistory.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { conversationService } from './conversationService.js'
import { sessionService } from './sessionService.js'

type RewindTarget = {
  targetUserMessageId: string
  userMessageIndex: number
  userMessageCount: number
  messagesRemoved: number
}

type RewindCodePreview = {
  available: boolean
  reason?: string
  filesChanged: string[]
  insertions: number
  deletions: number
}

export type RewindTargetSelector = {
  targetUserMessageId?: string
  userMessageIndex?: number
  expectedContent?: string
}

export type SessionRewindPreview = {
  target: {
    targetUserMessageId: string
    userMessageIndex: number
    userMessageCount: number
  }
  conversation: {
    messagesRemoved: number
  }
  code: RewindCodePreview
}

export type SessionRewindExecuteResult = SessionRewindPreview & {
  conversation: SessionRewindPreview['conversation'] & {
    removedMessageIds: string[]
  }
}

function normalizeDiffStats(diffStats: {
  filesChanged?: string[]
  insertions?: number
  deletions?: number
} | undefined): RewindCodePreview {
  return {
    available: true,
    filesChanged: diffStats?.filesChanged ?? [],
    insertions: diffStats?.insertions ?? 0,
    deletions: diffStats?.deletions ?? 0,
  }
}

function normalizePromptText(text: string): string {
  return text.replace(/\r\n/g, '\n').trim()
}

function extractUserPromptText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .flatMap((block) => {
      if (!block || typeof block !== 'object') return []
      const record = block as Record<string, unknown>
      return record.type === 'text' && typeof record.text === 'string'
        ? [record.text]
        : []
    })
    .join('\n')
}

function assertExpectedPromptMatches(
  targetMessage: { content: unknown },
  expectedContent: string | undefined,
): void {
  if (expectedContent === undefined) return

  const actual = normalizePromptText(extractUserPromptText(targetMessage.content))
  const expected = normalizePromptText(expectedContent)
  if (actual !== expected) {
    throw ApiError.badRequest(
      'The resolved rewind target does not match the selected prompt. Refresh the session and try again.',
    )
  }
}

async function resolveRewindTarget(
  sessionId: string,
  selector: RewindTargetSelector,
): Promise<RewindTarget> {
  const activeMessages = await sessionService.getSessionMessages(sessionId)
  const userMessages = activeMessages.filter((message) => message.type === 'user')

  if (userMessages.length === 0) {
    throw ApiError.badRequest('This session has no user messages to rewind.')
  }

  let targetUserMessage = null as (typeof userMessages)[number] | null
  let userMessageIndex = -1

  if (selector.targetUserMessageId) {
    const activeMessage = activeMessages.find(
      (message) => message.id === selector.targetUserMessageId,
    )
    if (activeMessage) {
      if (activeMessage.type !== 'user') {
        throw ApiError.badRequest('The selected rewind target is not a user message.')
      }
      targetUserMessage = activeMessage
      userMessageIndex = userMessages.findIndex(
        (message) => message.id === activeMessage.id,
      )
    }
  }

  if (!targetUserMessage && Number.isInteger(selector.userMessageIndex)) {
    userMessageIndex = selector.userMessageIndex!
    if (userMessageIndex >= 0 && userMessageIndex < userMessages.length) {
      targetUserMessage = userMessages[userMessageIndex]!
    }
  }

  if (
    !targetUserMessage ||
    userMessageIndex < 0 ||
    userMessageIndex >= userMessages.length
  ) {
    throw ApiError.badRequest(
      `Invalid rewind target. Expected targetUserMessageId or userMessageIndex 0-${userMessages.length - 1}.`,
    )
  }

  assertExpectedPromptMatches(targetUserMessage, selector.expectedContent)

  const activeMessageIndex = activeMessages.findIndex(
    (message) => message.id === targetUserMessage.id,
  )

  if (activeMessageIndex < 0) {
    throw ApiError.badRequest('The selected user message is not in the active chain.')
  }

  return {
    targetUserMessageId: targetUserMessage.id,
    userMessageIndex,
    userMessageCount: userMessages.length,
    messagesRemoved: activeMessages.length - activeMessageIndex,
  }
}

async function loadFileHistorySnapshots(
  sessionId: string,
): Promise<FileHistorySnapshot[] | null> {
  const snapshots = await sessionService.getSessionFileHistorySnapshots(sessionId)
  if (snapshots.length === 0) {
    return null
  }

  return snapshots
}

function expandTrackingPath(workDir: string, trackingPath: string): string {
  return isAbsolute(trackingPath) ? trackingPath : join(workDir, trackingPath)
}

function resolveBackupPath(sessionId: string, backupFileName: string): string {
  return join(getClaudeConfigHomeDir(), 'file-history', sessionId, backupFileName)
}

function collectTrackedPaths(
  snapshots: FileHistorySnapshot[],
): Set<string> {
  const trackedPaths = new Set<string>()
  for (const snapshot of snapshots) {
    for (const trackingPath of Object.keys(snapshot.trackedFileBackups)) {
      trackedPaths.add(trackingPath)
    }
  }
  return trackedPaths
}

function findTargetSnapshot(
  snapshots: FileHistorySnapshot[],
  targetUserMessageId: string,
): FileHistorySnapshot | null {
  return (
    snapshots.findLast((snapshot) => snapshot.messageId === (targetUserMessageId as UUID)) ??
    null
  )
}

function getBackupFileNameFirstVersion(
  trackingPath: string,
  snapshots: FileHistorySnapshot[],
): string | null | undefined {
  for (const snapshot of snapshots) {
    const backup = snapshot.trackedFileBackups[trackingPath]
    if (backup !== undefined && backup.version === 1) {
      return backup.backupFileName
    }
  }

  return undefined
}

async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8')
  } catch {
    return null
  }
}

async function hasFileChanged(
  filePath: string,
  backupFilePath: string,
): Promise<boolean> {
  try {
    const [currentStat, backupStat] = await Promise.all([
      stat(filePath),
      stat(backupFilePath),
    ])

    if (currentStat.size !== backupStat.size) {
      return true
    }

    const [currentContent, backupContent] = await Promise.all([
      readFile(filePath),
      readFile(backupFilePath),
    ])
    return !currentContent.equals(backupContent)
  } catch {
    return true
  }
}

async function restoreBackupFile(
  filePath: string,
  backupFilePath: string,
): Promise<void> {
  const backupStats = await stat(backupFilePath)
  try {
    await copyFile(backupFilePath, filePath)
  } catch (error) {
    const maybeErr = error as NodeJS.ErrnoException
    if (maybeErr.code !== 'ENOENT') throw error
    await mkdir(dirname(filePath), { recursive: true })
    await copyFile(backupFilePath, filePath)
  }
  await chmod(filePath, backupStats.mode)
}

async function buildCodePreview(
  sessionId: string,
  workDir: string,
  targetUserMessageId: string,
): Promise<{
  snapshots: FileHistorySnapshot[] | null
  preview: RewindCodePreview
}> {
  const snapshots = await loadFileHistorySnapshots(sessionId)
  if (!snapshots) {
    return {
      snapshots: null,
      preview: {
        available: false,
        reason: 'No file checkpoints were recorded for this session.',
        filesChanged: [],
        insertions: 0,
        deletions: 0,
      },
    }
  }

  const targetSnapshot = findTargetSnapshot(snapshots, targetUserMessageId)
  if (!targetSnapshot) {
    return {
      snapshots,
      preview: {
        available: false,
        reason: 'No file checkpoint is available for the selected message.',
        filesChanged: [],
        insertions: 0,
        deletions: 0,
      },
    }
  }

  const trackedPaths = collectTrackedPaths(snapshots)
  const filesChanged: string[] = []
  let insertions = 0
  let deletions = 0

  for (const trackingPath of trackedPaths) {
    const targetBackup = targetSnapshot.trackedFileBackups[trackingPath]
    const backupFileName =
      targetBackup?.backupFileName ??
      getBackupFileNameFirstVersion(trackingPath, snapshots)

    if (backupFileName === undefined) continue

    const absolutePath = expandTrackingPath(workDir, trackingPath)

    if (backupFileName === null) {
      try {
        await stat(absolutePath)
        filesChanged.push(absolutePath)
      } catch {
        // File is already absent.
      }
      continue
    }

    const backupFilePath = resolveBackupPath(sessionId, backupFileName)
    if (!(await hasFileChanged(absolutePath, backupFilePath))) {
      continue
    }

    filesChanged.push(absolutePath)
    const [currentContent, backupContent] = await Promise.all([
      readFileOrNull(absolutePath),
      readFileOrNull(backupFilePath),
    ])
    for (const change of diffLines(currentContent ?? '', backupContent ?? '')) {
      if (change.added) {
        insertions += change.count || 0
      }
      if (change.removed) {
        deletions += change.count || 0
      }
    }
  }

  return {
    snapshots,
    preview: normalizeDiffStats({
      filesChanged,
      insertions,
      deletions,
    }),
  }
}

export async function previewSessionRewind(
  sessionId: string,
  selector: RewindTargetSelector,
): Promise<SessionRewindPreview> {
  const target = await resolveRewindTarget(sessionId, selector)
  const workDir =
    (conversationService.hasSession(sessionId)
      ? conversationService.getSessionWorkDir(sessionId)
      : null) ||
    (await sessionService.getSessionWorkDir(sessionId)) ||
    process.cwd()
  const { preview } = await buildCodePreview(
    sessionId,
    workDir,
    target.targetUserMessageId,
  )

  return {
    target: {
      targetUserMessageId: target.targetUserMessageId,
      userMessageIndex: target.userMessageIndex,
      userMessageCount: target.userMessageCount,
    },
    conversation: {
      messagesRemoved: target.messagesRemoved,
    },
    code: preview,
  }
}

export async function executeSessionRewind(
  sessionId: string,
  selector: RewindTargetSelector,
): Promise<SessionRewindExecuteResult> {
  const target = await resolveRewindTarget(sessionId, selector)
  const workDir =
    (conversationService.hasSession(sessionId)
      ? conversationService.getSessionWorkDir(sessionId)
      : null) ||
    (await sessionService.getSessionWorkDir(sessionId)) ||
    process.cwd()
  const { snapshots, preview } = await buildCodePreview(
    sessionId,
    workDir,
    target.targetUserMessageId,
  )

  if (conversationService.hasSession(sessionId)) {
    conversationService.stopSession(sessionId)
  }

  if (preview.available && snapshots) {
    const targetSnapshot = findTargetSnapshot(snapshots, target.targetUserMessageId)
    if (!targetSnapshot) {
      throw ApiError.badRequest('No file checkpoint is available for the selected message.')
    }

    for (const trackingPath of collectTrackedPaths(snapshots)) {
      const targetBackup = targetSnapshot.trackedFileBackups[trackingPath]
      const backupFileName =
        targetBackup?.backupFileName ??
        getBackupFileNameFirstVersion(trackingPath, snapshots)

      if (backupFileName === undefined) continue

      const absolutePath = expandTrackingPath(workDir, trackingPath)

      if (backupFileName === null) {
        try {
          await unlink(absolutePath)
        } catch (error) {
          const maybeErr = error as NodeJS.ErrnoException
          if (maybeErr.code !== 'ENOENT') throw error
        }
        continue
      }

      await restoreBackupFile(
        absolutePath,
        resolveBackupPath(sessionId, backupFileName),
      )
    }
  }

  const trimResult = await sessionService.trimSessionMessagesFrom(
    sessionId,
    target.targetUserMessageId,
  )

  return {
    target: {
      targetUserMessageId: target.targetUserMessageId,
      userMessageIndex: target.userMessageIndex,
      userMessageCount: target.userMessageCount,
    },
    conversation: {
      messagesRemoved: trimResult.removedCount,
      removedMessageIds: trimResult.removedMessageIds,
    },
    code: preview,
  }
}
