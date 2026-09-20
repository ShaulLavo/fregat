import type { AttachmentOwnership } from './ownership'
import {
  CHAT_ATTACHMENT_URL_PREFIX,
  MAX_CHAT_ATTACHMENTS,
  MAX_CHAT_ATTACHMENT_BYTES,
  MAX_CHAT_FILE_ATTACHMENT_BYTES,
  attachmentUploadInputSchema,
} from '@workspace/contracts'
import * as v from 'valibot'
import { Elysia } from 'elysia'

import { observeRequestOperation } from '../observability'
import {
  attachmentFilePath,
  defaultAttachmentsDir,
  resolveAttachmentFile,
  type AttachmentFile,
} from './store'
import {
  createAttachmentUpload,
  storeAttachmentUpload,
  uploadedAttachmentMetadata,
  deletePendingAttachmentUpload,
} from './uploads'

/**
 * Blob names carry a random id and their bytes are written exactly once, so a
 * hit never needs revalidating. `private` keeps a user's screenshots out of any
 * shared cache on the way back.
 */
const ATTACHMENT_CACHE_CONTROL = 'private, max-age=31536000, immutable'

/**
 * Serves the image bytes `attachments/store.ts` wrote at turn ingest. Without
 * this the transcript can only ever name an attachment, never show it: the
 * blobs live outside the workspace root, so the filesystem routes cannot reach
 * them. The path comes from the contract, so the `<img>` src the web derives
 * and the route mounted here cannot drift apart.
 */
export function attachmentRoutes({
  attachmentsDir = defaultAttachmentsDir(),
  ownership,
}: {
  attachmentsDir?: string
  ownership: AttachmentOwnership
}) {
  return new Elysia({ name: 'attachment-routes' })
    .get('/attachments/capabilities', () => ({
      files: true,
      maxCount: MAX_CHAT_ATTACHMENTS,
      maxImageBytes: MAX_CHAT_ATTACHMENT_BYTES,
      maxFileBytes: MAX_CHAT_FILE_ATTACHMENT_BYTES,
    }))
    .post('/attachments/uploads', ({ body }) =>
      createAttachmentUpload(attachmentsDir, v.parse(attachmentUploadInputSchema, body), ownership),
    )
    .put(
      '/attachments/uploads/:id',
      ({ params, request }) =>
        storeAttachmentUpload(attachmentsDir, params.id, request.body, ownership),
      { parse: 'none' },
    )
    .get('/attachments/uploads/:id', ({ params }) =>
      uploadedAttachmentMetadata(attachmentsDir, params.id, ownership),
    )
    .delete('/attachments/uploads/:id', async ({ params }) => {
      await deletePendingAttachmentUpload(attachmentsDir, params.id, ownership)
      return { removed: true }
    })
    .get(`${CHAT_ATTACHMENT_URL_PREFIX}/:fileName`, async ({ params, set }) => {
      const file = await observeRequestOperation(
        { area: 'attachments', operation: 'read' },
        () => resolveServedAttachment(attachmentsDir, params.fileName, ownership),
        (result) => summarizeAttachmentFile(params.fileName, result),
      )
      if (!file) {
        set.status = 404
        return { error: { message: 'attachment unavailable' } }
      }

      return new Response(Bun.file(file.filePath), {
        headers: {
          'cache-control': ATTACHMENT_CACHE_CONTROL,
          'content-length': String(file.byteLength),
          'content-type': file.contentType,
          'x-content-type-options': 'nosniff',
          ...(file.downloadName
            ? {
                'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.downloadName)}`,
              }
            : {}),
        },
      })
    })
}

async function resolveServedAttachment(
  attachmentsDir: string,
  fileName: string,
  ownership: AttachmentOwnership,
): Promise<(AttachmentFile & { downloadName?: string }) | null> {
  if (!fileName.endsWith('.bin')) return resolveAttachmentFile({ attachmentsDir, fileName })
  const metadata = await uploadedAttachmentMetadata(
    attachmentsDir,
    fileName.slice(0, -4),
    ownership,
  ).catch(() => null)
  if (!metadata?.ready || metadata.attachment.type !== 'file') return null
  const filePath = attachmentFilePath({ attachmentsDir, attachment: metadata.attachment })
  if (!filePath) return null
  return {
    filePath,
    byteLength: metadata.attachment.sizeBytes,
    contentType: metadata.attachment.mimeType,
    downloadName: metadata.attachment.name,
  }
}

function summarizeAttachmentFile(
  fileName: string,
  file: AttachmentFile | null,
): Record<string, unknown> {
  if (!file) return { available: false, fileName }

  return {
    available: true,
    byteLength: file.byteLength,
    contentType: file.contentType,
    fileName,
  }
}
