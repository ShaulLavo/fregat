import { createClientInvariantError } from '@/lib/structured-errors'

import { MAX_CHAT_ATTACHMENTS, type ChatAttachmentUpload } from '@workspace/contracts'

import type {
  ChatInputDraftTarget,
  ChatInputImageAttachment,
} from '@/features/chat/state/chat-input-draft-store'

import {
  classifyChatImageFile,
  MAX_CHAT_ATTACHMENT_ENCODED_BYTES,
} from '@/features/chat/utils/input-attachment-limits'
import {
  compressImageToByteLimit,
  type ImageCompressionFailureReason,
} from '@/features/chat/utils/image-compression'

const IMAGE_ATTACHMENT_ID_PREFIX = 'image'

export function imageFilesFromTransfer(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) return []

  return imageFilesFromFileList(dataTransfer.files)
}

export function imageFilesFromClipboard(clipboardData: DataTransfer | null) {
  if (!clipboardData) return []

  return imageFilesFromFileList(clipboardData.files)
}

/**
 * The shape the composer submits. `dataUrl` is kept — it is the only copy of
 * the bytes, and stripping it here is what used to make every pasted image a
 * no-op. `previewUrl` is dropped: it exists purely to paint the local preview.
 */
export function chatInputUploadAttachments(
  attachments: readonly ChatInputImageAttachment[],
): ChatAttachmentUpload[] {
  return attachments.map(({ previewUrl: _previewUrl, ...attachment }) => attachment)
}

/**
 * Classifies, compresses and stages a batch of dropped/pasted/picked files.
 * Every file goes through the same gate, so the count cap and the media-type
 * allowlist hold no matter which capture path produced them.
 */
export async function stageChatInputImageFiles({
  addImages,
  draftTarget,
  existingImageCount,
  files,
  onError,
}: {
  addImages: (target: ChatInputDraftTarget, images: readonly ChatInputImageAttachment[]) => number
  draftTarget: ChatInputDraftTarget
  existingImageCount: number
  files: readonly File[]
  onError: (error: string | null) => void
}) {
  if (files.length === 0) return

  const staged: ChatInputImageAttachment[] = []
  let rejection: string | null = null

  for (const file of files) {
    const prepared = await prepareChatInputImage(file, existingImageCount + staged.length)
    if (prepared.status === 'reject') {
      // First refusal wins: the composer shows one sentence, and the first
      // cause is the one the user is most likely to be able to act on.
      rejection ??= prepared.message
      continue
    }

    staged.push(prepared.attachment)
  }

  const accepted = staged.length > 0 ? addImages(draftTarget, staged) : 0
  if (accepted < staged.length) rejection ??= `Up to ${MAX_CHAT_ATTACHMENTS} images per message.`
  onError(rejection)
}

type PreparedChatInputImage =
  | { status: 'accept'; attachment: ChatInputImageAttachment }
  | { status: 'reject'; message: string }

async function prepareChatInputImage(
  file: File,
  currentCount: number,
): Promise<PreparedChatInputImage> {
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

function imageFilesFromFileList(fileList: FileList) {
  return Array.from(fileList).filter(isImageFile)
}

// Deliberately wider than the allowlist: anything the OS calls an image reaches
// the classifier, so a HEIC paste gets a sentence explaining itself instead of
// being silently swallowed like a dropped folder or text selection.
function isImageFile(file: File) {
  return file.type.toLowerCase().startsWith('image/')
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
