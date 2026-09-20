import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ChatAttachment } from '@workspace/contracts'

/**
 * Pure SDKUserMessage builder. Bytes are supplied by the caller, so this module
 * stays fs-free and the SDK import stays type-only.
 *
 * Note the shape difference from Codex, which is why the two cannot share code:
 * Codex takes the attachment's data URL verbatim as `{ type: 'image', url }`,
 * while Claude needs it split into a `media_type` plus raw base64 with no
 * `data:` prefix.
 */

type ClaudeContentBlock = Extract<SDKUserMessage['message']['content'], readonly unknown[]>[number]

/** The four image types the Anthropic API accepts. Anything else hard-fails the turn. */
export type ClaudeImageMediaType = 'image/gif' | 'image/jpeg' | 'image/png' | 'image/webp'

export type ResolvedAttachment =
  | {
      attachment: ChatAttachment
      bytes: Uint8Array
    }
  | { attachment: ChatAttachment; path: string }

/**
 * The allowlist guard. `chatAttachmentSchema` only enforces `/^image\//i`, so
 * this — deliberately the same four types as `extensionForMimeType` in
 * attachments/utils/paths.ts — is the real gate. Unsupported types are dropped
 * rather than thrown on, so one stray `image/bmp` cannot fail an entire turn.
 */
export function claudeImageMediaType(mimeType: string): ClaudeImageMediaType | null {
  const normalized = mimeType.trim().toLowerCase()

  if (normalized === 'image/jpeg') return 'image/jpeg'
  if (normalized === 'image/png') return 'image/png'
  if (normalized === 'image/gif') return 'image/gif'
  if (normalized === 'image/webp') return 'image/webp'
  return null
}

/**
 * The attachments `claudeUserMessage` will silently drop. Exported so the
 * adapter can warn about them by name instead of re-deriving the rule.
 */
export function claudeUnsupportedAttachments(
  resolved: readonly ResolvedAttachment[],
): ChatAttachment[] {
  const unsupported: ChatAttachment[] = []
  for (const entry of resolved) {
    if (entry.attachment.type !== 'image') continue
    if (claudeImageMediaType(entry.attachment.mimeType)) continue

    unsupported.push(entry.attachment)
  }

  return unsupported
}

export function claudeUserMessage(input: {
  messageText: string
  resolved: readonly ResolvedAttachment[]
}): SDKUserMessage {
  const content: ClaudeContentBlock[] = []
  // Text first, mirroring codexTurnInput's ordering rule so both providers
  // present a turn identically. The second clause keeps an empty message
  // sendable when it carries no attachments either.
  if (input.messageText.length > 0 || input.resolved.length === 0) {
    content.push({ text: input.messageText, type: 'text' })
  }

  for (const entry of input.resolved) {
    if ('path' in entry) {
      content.push({
        type: 'text',
        text: `Attached file ${JSON.stringify(entry.attachment.name)}: ${JSON.stringify(entry.path)}`,
      })
      continue
    }
    if (entry.attachment.type !== 'image') continue

    const mediaType = claudeImageMediaType(entry.attachment.mimeType)
    if (!mediaType) continue

    content.push({
      source: {
        data: Buffer.from(entry.bytes).toString('base64'),
        media_type: mediaType,
        type: 'base64',
      },
      type: 'image',
    })
  }

  // Same final guard as codexTurnInput: when every attachment was dropped and
  // there is no text, still send the (empty) text block. An empty content array
  // is rejected by the API.
  if (content.length === 0) content.push({ text: input.messageText, type: 'text' })

  return {
    message: { content, role: 'user' },
    parent_tool_use_id: null,
    session_id: '',
    type: 'user',
  }
}
