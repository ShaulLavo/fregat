import { chatAttachmentUrlPath, type ChatAttachment } from '@workspace/contracts'

/** What both the composer and the transcript hand the lightbox to paint. */
export type ChatAttachmentImage = {
  id: string
  name: string
  sizeBytes: number
  src: string
}

/** Composer-side shape: the bytes are still local, so the src is a data URL. */
type StagedAttachment = {
  id: string
  name: string
  previewUrl: string
  sizeBytes: number
}

/**
 * Absolute URL for a sent attachment's bytes. Null when the type is outside the
 * stored allowlist — the server dropped that blob at ingest, so there is
 * genuinely nothing to show and the caller must fall back to the file name.
 */
function chatAttachmentImageSrc(attachment: ChatAttachment, origin: string): string | null {
  const urlPath = chatAttachmentUrlPath(attachment)
  if (!urlPath) return null

  return `${origin.replace(/\/+$/u, '')}${urlPath}`
}

export function chatAttachmentImages(
  attachments: readonly ChatAttachment[],
  origin: string,
): ChatAttachmentImage[] {
  const images: ChatAttachmentImage[] = []

  for (const attachment of attachments) {
    const src = chatAttachmentImageSrc(attachment, origin)
    if (!src) continue

    images.push({
      id: attachment.id,
      name: attachment.name,
      sizeBytes: attachment.sizeBytes,
      src,
    })
  }

  return images
}

export function unrenderableChatAttachments(
  attachments: readonly ChatAttachment[],
): ChatAttachment[] {
  return attachments.filter((attachment) => !chatAttachmentUrlPath(attachment))
}

export function stagedAttachmentImages(
  attachments: readonly StagedAttachment[],
): ChatAttachmentImage[] {
  return attachments.map((attachment) => ({
    id: attachment.id,
    name: attachment.name,
    sizeBytes: attachment.sizeBytes,
    src: attachment.previewUrl,
  }))
}
