import type { ChatAttachment } from '@workspace/contracts'
import { attachmentFilePath } from '../../../attachments/store'
import { createInternalError } from '../../../observability/structured-errors'

export async function resolveCodexAttachments(
  attachments: readonly ChatAttachment[],
  attachmentsDir: string,
) {
  const resolved: Array<ChatAttachment & { localPath?: string }> = []
  for (const attachment of attachments) {
    if ('dataUrl' in attachment || 'url' in attachment) {
      resolved.push(attachment)
      continue
    }
    const localPath = attachmentFilePath({ attachmentsDir, attachment })
    if (!localPath || !(await Bun.file(localPath).exists()))
      throw createInternalError(`Attachment ${attachment.name} is unavailable. Attach it again.`)
    resolved.push({ ...attachment, localPath })
  }
  return resolved
}
