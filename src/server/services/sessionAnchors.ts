/**
 * Session user-question anchors.
 *
 * Extracts the full list of "real user questions" from a session transcript
 * so the desktop MessageAnchorRail can render bars for the entire history —
 * including messages that have not been loaded into the client's sliding
 * window yet.
 *
 * The filtering rules mirror what the desktop message pipeline produces:
 * history entries are first normalized through SessionService.entriesToMessages
 * (same source as the paginated history endpoint), then filtered exactly like
 * MessageList's messageAnchors:
 *  - strip injected <system-reminder> blocks, keep the real text that follows
 *  - skip turns that are pure system notifications
 *  - skip <task-notification> / <command-message> / <local-command> breadcrumbs
 *  - skip teammate messages (excluded from the chat history by default)
 *  - preview = first non-empty line that does not start with '<'
 */

import type { MessageEntry } from './sessionService.js'

export type SessionUserAnchor = {
  /** Global 0-based index of the question across the whole session. */
  seq: number
  /** Transcript message id (matches the UI message's serverId). */
  messageId: string
  preview: string
  /** Last meaningful assistant text before the next user turn. */
  answerPreview?: string
}

const SYSTEM_REMINDER_REGEX = /<system-reminder>[\s\S]*?(<\/system-reminder>|$)/g
const NON_QUESTION_PREFIX_REGEX = /^<(task-notification|command-message|local-command)/

function extractUserText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return (content as Array<{ type?: string; text?: string }>)
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text!)
    .join('\n')
}

function extractAssistantPreview(content: unknown): string {
  const text = extractUserText(content)
  const firstLine = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('<') && !line.startsWith('```')) ?? ''
  return firstLine
    .replace(/^(?:#{1,6}\s+|[-*>]\s+)/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isTeammateMessage(text: string): boolean {
  return text.includes('<teammate-message') && text.includes('</teammate-message>')
}

export function extractUserMessageAnchors(messages: MessageEntry[]): SessionUserAnchor[] {
  const anchors: SessionUserAnchor[] = []
  let currentAnchor: SessionUserAnchor | null = null
  for (const msg of messages) {
    if (msg.type === 'assistant' && currentAnchor) {
      const answerPreview = extractAssistantPreview(msg.content)
      if (answerPreview) currentAnchor.answerPreview = answerPreview
      continue
    }
    if (msg.type !== 'user') continue
    currentAnchor = null
    const text = extractUserText(msg.content)
    if (!text.trim()) continue
    if (isTeammateMessage(text)) continue
    const stripped = text.replace(SYSTEM_REMINDER_REGEX, '').trim()
    if (!stripped) continue
    if (NON_QUESTION_PREFIX_REGEX.test(stripped)) continue
    const firstLine = stripped
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('<')) ?? ''
    if (!firstLine) continue
    currentAnchor = { seq: anchors.length, messageId: msg.id, preview: firstLine }
    anchors.push(currentAnchor)
  }
  return anchors
}
