import { createClientInvariantError } from '@/lib/structured-errors'

import {
  MAX_CHAT_ATTACHMENTS,
  MAX_CHAT_FILE_ATTACHMENT_BYTES,
  type ChatAttachmentUpload,
} from '@workspace/contracts'

import type { ChatInputAttachment } from '@/features/chat/state/chat-input-draft-store'

import { MAX_CHAT_ATTACHMENT_ENCODED_BYTES } from '@workspace/client-core/chat/attachments'
import { classifyChatImageFile } from '@/features/chat/utils/input-attachment-limits'
import {
  compressImageToByteLimit,
  type ImageCompressionFailureReason,
} from '@/features/chat/utils/image-compression'

const IMAGE_ATTACHMENT_ID_PREFIX = 'image'

export function filesFromTransfer(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) return []

  return filesFromFileList(dataTransfer.files)
}

/**
 * The shape the composer submits. `dataUrl` is kept — it is the only copy of
 * the bytes, and stripping it here is what used to make every pasted image a
 * no-op. `previewUrl` is dropped: it exists purely to paint the local preview.
 */
export function chatInputUploadAttachments(
  attachments: readonly ChatInputAttachment[],
): ChatAttachmentUpload[] {
  return attachments.map(({ previewUrl: _previewUrl, upload, ...attachment }) => {
    if (!upload) return attachment
    if (upload.status !== 'ready')
      throw createClientInvariantError('Wait for attachments to upload, or retry failed files.')
    return upload.attachment
  })
}

type PreparedChatInputImage =
  | { status: 'accept'; attachment: ChatInputAttachment; blob: Blob }
  | { status: 'reject'; message: string }

export async function prepareChatInputFile(
  file: File,
  currentCount: number,
): Promise<PreparedChatInputImage> {
  if (!file.type.toLowerCase().startsWith('image/')) {
    if (currentCount >= MAX_CHAT_ATTACHMENTS)
      return { status: 'reject', message: `Up to ${MAX_CHAT_ATTACHMENTS} files per message.` }
    if (file.size === 0 || file.size > MAX_CHAT_FILE_ATTACHMENT_BYTES)
      return { status: 'reject', message: 'Files must contain between 1 byte and 50 MB.' }
    return {
      status: 'accept',
      blob: file,
      attachment: {
        type: 'file',
        id: `file-${crypto.randomUUID()}`,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        previewUrl: '',
      },
    }
  }
  const classification = classifyChatImageFile(file, currentCount)
  if (classification.status === 'reject') {
    return { status: 'reject', message: classification.message }
  }

  // The encoded budget, not the wire cap: what gets sent is the base64 data URL
  // below, and compressing to the cap itself ships a third more than it allows.
  const compressed = await compressImageToByteLimit(file, MAX_CHAT_ATTACHMENT_ENCODED_BYTES)
  if (!compressed.ok) {
    return { status: 'reject', message: compressionFailureMessage(compressed.reason) }
  }

  const dataUrl = await readFileAsDataUrl(compressed.file).catch(() => null)
  if (!dataUrl) return { status: 'reject', message: 'That image could not be read.' }

  return {
    status: 'accept',
    blob: compressed.file,
    attachment: {
      dataUrl,
      id: `${IMAGE_ATTACHMENT_ID_PREFIX}-${crypto.randomUUID()}`,
      // A pass-through keeps the classifier's normalized type; a re-encode
      // reports what the codec actually produced. Either way it is allowlisted.
      mimeType: compressed.recompressed ? compressed.mimeType : classification.mimeType,
      name: compressed.file.name || 'image',
      previewUrl: dataUrl,
      sizeBytes: compressed.file.size,
      type: 'image',
    },
  }
}

function compressionFailureMessage(reason: ImageCompressionFailureReason) {
  if (reason === 'unreadable') return 'That image could not be read.'

  return 'That image is too large to send.'
}

function filesFromFileList(fileList: FileList) {
  return Array.from(fileList)
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(createClientInvariantError('Image attachment did not produce a data URL.'))
    })
    reader.addEventListener('error', () => {
      reject(reader.error ?? createClientInvariantError('Image attachment could not be read.'))
    })
    reader.readAsDataURL(file)
  })
}
