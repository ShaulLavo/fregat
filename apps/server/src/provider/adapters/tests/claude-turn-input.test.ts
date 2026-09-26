import { describe, expect, it } from 'vitest'
import type { ChatAttachment } from '@workspace/contracts'
import {
  claudeImageMediaType,
  claudeUnsupportedAttachments,
  claudeUserMessage,
  type ResolvedAttachment,
} from '../utils/claude-turn-input'

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff])

function attachment(overrides: Partial<ChatAttachment> = {}): ChatAttachment {
  return {
    id: 'attachment-1',
    mimeType: 'image/png',
    name: 'shot.png',
    sizeBytes: PNG_BYTES.length,
    type: 'image',
    ...overrides,
  }
}

function resolved(overrides: Partial<ChatAttachment> = {}): ResolvedAttachment {
  return { attachment: attachment(overrides), bytes: PNG_BYTES }
}

// A string body would fail every length assertion below, so returning an empty
// list keeps the narrowing honest without throwing out of a helper.
function contentBlocks(message: ReturnType<typeof claudeUserMessage>) {
  const content = message.message.content
  if (typeof content === 'string') return []

  return content
}

describe('claudeImageMediaType', () => {
  it('accepts exactly the Anthropic allowlist', () => {
    expect(claudeImageMediaType('image/jpeg')).toBe('image/jpeg')
    expect(claudeImageMediaType('image/png')).toBe('image/png')
    expect(claudeImageMediaType('image/gif')).toBe('image/gif')
    expect(claudeImageMediaType('image/webp')).toBe('image/webp')
  })

  it('normalizes case and surrounding whitespace', () => {
    expect(claudeImageMediaType('  IMAGE/PNG ')).toBe('image/png')
  })

  it('accepts the aliases the upload gate accepts', () => {
    expect(claudeImageMediaType('image/jpg')).toBe('image/jpeg')
    expect(claudeImageMediaType('image/png; charset=binary')).toBe('image/png')
  })

  it('rejects image types the API cannot read', () => {
    expect(claudeImageMediaType('image/bmp')).toBeNull()
    expect(claudeImageMediaType('image/svg+xml')).toBeNull()
    expect(claudeImageMediaType('image/heic')).toBeNull()
    expect(claudeImageMediaType('application/pdf')).toBeNull()
  })
})

describe('claudeUserMessage', () => {
  it('envelopes the message as a user turn', () => {
    const message = claudeUserMessage({ messageText: 'hi', resolved: [] })

    expect(message.type).toBe('user')
    expect(message.parent_tool_use_id).toBeNull()
    expect(message.message.role).toBe('user')
  })

  it('puts text before the image when both are present', () => {
    const blocks = contentBlocks(
      claudeUserMessage({ messageText: 'look at this', resolved: [resolved()] }),
    )

    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toEqual({ text: 'look at this', type: 'text' })
    expect(blocks[1]?.type).toBe('image')
  })

  it('sends a lone image with no empty text block', () => {
    const blocks = contentBlocks(claudeUserMessage({ messageText: '', resolved: [resolved()] }))

    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.type).toBe('image')
  })

  it('sends an empty message that carries no attachments', () => {
    const blocks = contentBlocks(claudeUserMessage({ messageText: '', resolved: [] }))

    expect(blocks).toEqual([{ text: '', type: 'text' }])
  })

  it('round-trips the attachment bytes through base64', () => {
    const blocks = contentBlocks(claudeUserMessage({ messageText: '', resolved: [resolved()] }))

    const block = blocks[0]
    expect(block?.type).toBe('image')
    if (block?.type !== 'image') return
    expect(block.source.type).toBe('base64')
    if (block.source.type !== 'base64') return

    expect(block.source.media_type).toBe('image/png')
    expect(block.source.data.startsWith('data:')).toBe(false)
    expect(new Uint8Array(Buffer.from(block.source.data, 'base64'))).toEqual(PNG_BYTES)
  })

  it('keeps every supported attachment in order', () => {
    const blocks = contentBlocks(
      claudeUserMessage({
        messageText: 'two files',
        resolved: [
          resolved({ id: 'a', mimeType: 'image/png' }),
          resolved({ id: 'b', mimeType: 'image/webp' }),
        ],
      }),
    )

    expect(blocks).toHaveLength(3)
    expect(blocks.map((block) => block.type)).toEqual(['text', 'image', 'image'])
  })

  it('drops an unsupported mime type instead of failing the turn', () => {
    const blocks = contentBlocks(
      claudeUserMessage({
        messageText: 'still sends',
        resolved: [resolved({ mimeType: 'image/bmp' })],
      }),
    )

    expect(blocks).toEqual([{ text: 'still sends', type: 'text' }])
  })

  it('falls back to the text block when every attachment was dropped', () => {
    const blocks = contentBlocks(
      claudeUserMessage({ messageText: '', resolved: [resolved({ mimeType: 'image/svg+xml' })] }),
    )

    expect(blocks).toEqual([{ text: '', type: 'text' }])
  })
})

describe('claudeUnsupportedAttachments', () => {
  it('names the attachments the builder will drop', () => {
    const dropped = claudeUnsupportedAttachments([
      resolved({ id: 'ok', mimeType: 'image/png' }),
      resolved({ id: 'bad', mimeType: 'image/bmp' }),
    ])

    expect(dropped.map((entry) => entry.id)).toEqual(['bad'])
  })

  it('is empty when every attachment is supported', () => {
    expect(claudeUnsupportedAttachments([resolved()])).toEqual([])
  })
})
