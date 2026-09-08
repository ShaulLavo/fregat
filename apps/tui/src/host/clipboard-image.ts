import { createHostClipboard, type HostClipboardService } from '@opentui/core'
import { MAX_CHAT_ATTACHMENT_BYTES } from '@workspace/contracts'
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
    maxReadBytes: MAX_CHAT_ATTACHMENT_BYTES,
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
    if (result.representation.bytes.byteLength > MAX_CHAT_ATTACHMENT_BYTES)
      throw createTuiError(
        'The clipboard image is too large.',
        'Choose an image smaller than 10 MiB.',
      )
    signal.throwIfAborted()
    return result.representation
  } finally {
    await clipboard.dispose()
  }
}
