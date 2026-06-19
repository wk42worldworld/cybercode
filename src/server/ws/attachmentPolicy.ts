import type { AttachmentRef } from './events.js'

export function getInlineFileAttachmentsWithoutPath(attachments: AttachmentRef[] | undefined): AttachmentRef[] {
  return (attachments ?? []).filter((attachment) =>
    attachment.type === 'file' &&
    !attachment.path &&
    Boolean(attachment.data)
  )
}

export function buildPathRequiredAttachmentMessage(attachments: AttachmentRef[]): string {
  const firstName = attachments[0]?.name || 'selected file'
  if (attachments.length === 1) {
    return `File attachments must be sent by local path, not inline data: ${firstName}. Use the desktop file picker so the agent receives a file path.`
  }

  return `File attachments must be sent by local path, not inline data (${attachments.length} files). Use the desktop file picker so the agent receives file paths.`
}
