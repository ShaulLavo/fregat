import * as v from 'valibot'
import {
  attachmentUploadTicketSchema,
  attachmentUploadInputSchema,
  chatAttachmentSchema,
  chatAttachmentUrlPath,
  type EnvironmentId,
  type ChatAttachment,
} from '@workspace/contracts'
import { confirmedEnvironmentOrigin } from '@/lib/environments/state/domain'
import { environmentClientFor, serverEndpoint } from '@/lib/client'
import { createClientInvariantError } from '@/lib/structured-errors'
import { readAttachmentBlob, storeAttachmentBlob, deleteAttachmentBlob } from './attachment-blobs'
import { createChatPipelineScope } from '../utils/pipeline-logging'

const controllers = new Map<string, AbortController>()
function attachmentBlobKey(environmentId: EnvironmentId, id: string) {
  return `${environmentId}:${id}`
}
export function cancelAttachmentUpload(environmentId: EnvironmentId, id: string) {
  controllers.get(attachmentBlobKey(environmentId, id))?.abort()
}
export async function uploadDraftAttachment(input: {
  environmentId: EnvironmentId
  attachment: ChatAttachment
  blob?: Blob
  onProgress: (progress: number) => boolean
}) {
  const key = attachmentBlobKey(input.environmentId, input.attachment.id)
  const scope = createChatPipelineScope('chat.attachment.upload', {
    environmentId: input.environmentId,
    attachmentId: input.attachment.id,
    attachmentType: input.attachment.type,
    sizeBytes: input.attachment.sizeBytes,
    phase: 'recovery-storage',
  })
  const controller = new AbortController()
  controllers.set(key, controller)
  const origin = confirmedEnvironmentOrigin(input.environmentId)
  const client = environmentClientFor(origin)
  let pendingId: string | undefined
  try {
    const blob = input.blob ?? (await readAttachmentBlob(key))
    if (!blob)
      throw createClientInvariantError(
        'The saved file is unavailable. Remove it and attach it again.',
      )
    if (input.blob) await storeAttachmentBlob(key, blob)
    scope.set({ phase: 'upload-ticket' })
    const metadata = v.parse(attachmentUploadInputSchema, input.attachment)
    const created = await client.attachments.uploads.post(metadata)
    scope.set({ ticketStatus: created.status })
    if (created.error)
      throw createClientInvariantError(
        'Could not prepare the attachment upload. Retry when connected.',
      )
    const ticket = v.parse(attachmentUploadTicketSchema, created.data)
    pendingId = ticket.attachment.id
    scope.set({ phase: 'upload-bytes', uploadId: pendingId })
    if (!input.onProgress(0)) controller.abort()
    const uploaded = await sendBytes(
      `${serverEndpoint(origin)}${ticket.uploadPath}`,
      blob,
      controller.signal,
      (progress) => {
        scope.set({ progress })
        if (!input.onProgress(progress)) controller.abort()
      },
      (uploadStatus) => scope.set({ uploadStatus }),
    )
    scope.set({ outcome: 'success', phase: 'complete' })
    return {
      attachment: uploaded,
      previewUrl: `${serverEndpoint(origin)}${chatAttachmentUrlPath(uploaded)}`,
      expiresAt: ticket.expiresAt,
    }
  } catch (error) {
    if (controller.signal.aborted) scope.set({ outcome: 'cancelled' })
    else scope.error(error, { outcome: 'failed' })
    if (pendingId)
      await client.attachments
        .uploads({ id: pendingId })
        .delete()
        .catch(() => undefined)
    throw error
  } finally {
    scope.end()
    controllers.delete(key)
  }
}
export async function removeDraftAttachment(
  environmentId: EnvironmentId,
  id: string,
  uploaded?: ChatAttachment,
) {
  cancelAttachmentUpload(environmentId, id)
  await deleteAttachmentBlob(attachmentBlobKey(environmentId, id))
  if (!uploaded) return
  const client = environmentClientFor(confirmedEnvironmentOrigin(environmentId))
  const result = await client.attachments.uploads({ id: uploaded.id }).delete()
  if (result.error) throw createClientInvariantError('The pending upload could not be removed.')
}
function sendBytes(
  url: string,
  blob: Blob,
  signal: AbortSignal,
  progress: (value: number) => void,
  responseStatus: (value: number) => void,
) {
  return new Promise<ChatAttachment>((resolve, reject) => {
    const request = new XMLHttpRequest()
    const abort = () => request.abort()
    request.open('PUT', url)
    request.withCredentials = true
    request.upload.onprogress = (event) =>
      progress(event.lengthComputable ? event.loaded / event.total : 0)
    request.onload = () => {
      responseStatus(request.status)
      signal.removeEventListener('abort', abort)
      if (request.status < 200 || request.status >= 300) {
        reject(createClientInvariantError('Attachment upload failed. Retry when connected.'))
        return
      }
      try {
        resolve(v.parse(chatAttachmentSchema, JSON.parse(request.responseText)))
      } catch {
        reject(createClientInvariantError('The upload response was invalid.'))
      }
    }
    request.onerror = () =>
      reject(createClientInvariantError('Attachment upload failed. Retry when connected.'))
    request.onabort = () => reject(createClientInvariantError('Attachment upload cancelled.'))
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) {
      reject(createClientInvariantError('Attachment upload cancelled.'))
      return
    }
    request.send(blob)
  })
}
