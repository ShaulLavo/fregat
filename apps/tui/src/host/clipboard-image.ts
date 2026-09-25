import { createHostClipboard, type HostClipboardService } from '@opentui/core'
import {
  MAX_CHAT_ATTACHMENT_ENCODED_BYTES,
  CHAT_ATTACHMENT_SIZE_LABEL,
} from '@workspace/client-core/chat/attachments'
import { createTuiError } from '@/host/utils/structured-errors'

export type ClipboardImage = {
  readonly mimeType: string
  readonly bytes: Uint8Array
}

export async function readClipboardImage(
  signal: AbortSignal,
  createClipboard: typeof createHostClipboard = createHostClipboard,
): Promise<ClipboardImage | null> {
  const clipboard: HostClipboardService = createClipboard({
    maxReadBytes: MAX_CHAT_ATTACHMENT_ENCODED_BYTES,
  })
  try {
    const result = await clipboard.read({
      preferredTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      signal,
    })
    if (result.status === 'cancelled' || result.status === 'empty') return null
    if (result.status !== 'read')
      throw createTuiError(
        `The clipboard image could not be read (${result.status}).`,
        'Copy a supported image on this machine, or use Attach files with a local path.',
      )
    if (result.representation.bytes.byteLength > MAX_CHAT_ATTACHMENT_ENCODED_BYTES)
      throw createTuiError(
        'The clipboard image is too large.',
        `Choose an image of at most ${CHAT_ATTACHMENT_SIZE_LABEL}.`,
      )
    signal.throwIfAborted()
    return result.representation
  } finally {
    await clipboard.dispose()
  }
}
