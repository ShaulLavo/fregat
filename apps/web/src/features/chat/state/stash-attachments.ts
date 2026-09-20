import { chatAttachmentUrlPath, type EnvironmentId } from '@workspace/contracts'
import { confirmedEnvironmentOrigin } from '@/lib/environments/state/domain'
import { serverEndpoint } from '@/lib/client'
import { createClientInvariantError } from '@/lib/structured-errors'
import type { ChatInputAttachment } from '../utils/attachment-draft'
import { removeDraftAttachment, uploadDraftAttachment } from './attachment-uploads'

export async function cloneStashAttachments(
  environmentId: EnvironmentId,
  attachments: readonly ChatInputAttachment[],
) {
  const cloned: ChatInputAttachment[] = []
  try {
    for (const attachment of attachments) {
      if (attachment.upload && attachment.upload.status !== 'ready')
        throw createClientInvariantError(
          'Wait for attachments to finish uploading before stashing.',
        )
      const metadata =
        attachment.upload?.status === 'ready' ? attachment.upload.attachment : attachment
      const source =
        attachment.dataUrl ??
        `${serverEndpoint(confirmedEnvironmentOrigin(environmentId))}${chatAttachmentUrlPath(metadata)}`
      const response = await fetch(source, { credentials: 'include' })
      if (!response.ok)
        throw createClientInvariantError(
          'This attachment is unavailable. Attach it again before restoring.',
        )
      const { dataUrl: _bytes, upload: _upload, previewUrl: _preview, ...base } = attachment
      const copy = { ...base, id: `stash-${crypto.randomUUID()}` }
      cloned.push({ ...copy, previewUrl: '' })
      const result = await uploadDraftAttachment({
        environmentId,
        attachment: copy,
        blob: await response.blob(),
        onProgress: () => true,
      })
      cloned[cloned.length - 1] = {
        ...copy,
        previewUrl: result.previewUrl,
        upload: { status: 'ready', attachment: result.attachment, expiresAt: result.expiresAt },
      }
    }
    return cloned
  } catch (error) {
    await releaseStashAttachments(environmentId, cloned)
    throw error
  }
}
export async function releaseStashAttachments(
  environmentId: EnvironmentId,
  attachments: readonly ChatInputAttachment[],
) {
  await Promise.allSettled(
    attachments.map((attachment) =>
      removeDraftAttachment(
        environmentId,
        attachment.id,
        attachment.upload?.status === 'ready' ? attachment.upload.attachment : undefined,
      ),
    ),
  )
}
