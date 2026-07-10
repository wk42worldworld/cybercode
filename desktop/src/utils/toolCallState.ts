import type { UIMessage } from '../types/chat'

/** Return unresolved tool calls belonging to the most recent user turn. */
export function getPendingToolUseIdsForLatestTurn(
  messages: UIMessage[],
): Set<string> {
  let latestUserIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.type === 'user_text' && !message.pending) {
      latestUserIndex = index
      break
    }
  }

  const resultIds = new Set<string>()
  for (let index = latestUserIndex + 1; index < messages.length; index += 1) {
    const message = messages[index]
    if (message?.type === 'tool_result') resultIds.add(message.toolUseId)
  }

  const pendingIds = new Set<string>()
  for (let index = latestUserIndex + 1; index < messages.length; index += 1) {
    const message = messages[index]
    if (
      message?.type === 'tool_use' &&
      message.toolUseId &&
      !resultIds.has(message.toolUseId)
    ) {
      pendingIds.add(message.toolUseId)
    }
  }

  return pendingIds
}
