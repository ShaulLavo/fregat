import { describe, expect, it } from 'vitest'
import * as v from 'valibot'
import {
  CHAT_ATTACHMENT_URL_PREFIX,
  chatAttachmentExtension,
  chatAttachmentSchema,
  chatAttachmentsSchema,
  chatAttachmentUploadsSchema,
  chatAttachmentUrlPath,
  MAX_CHAT_ATTACHMENT_BYTES,
  MAX_CHAT_ATTACHMENTS,
  orchestrationMessageSchema,
} from '../index'

function attachment(index: number, sizeBytes = 1_024) {
  return {
    type: 'image',
    id: `att-${index}`,
    name: `shot-${index}.png`,
    mimeType: 'image/png',
    sizeBytes,
  }
}

function attachments(count: number) {
  return Array.from({ length: count }, (_unused, index) => attachment(index))
}

describe('chat attachment limits', () => {
  it('accepts an attachment sitting exactly on the byte ceiling', () => {
    const parsed = v.parse(chatAttachmentSchema, attachment(0, MAX_CHAT_ATTACHMENT_BYTES))

    expect(parsed.sizeBytes).toBe(MAX_CHAT_ATTACHMENT_BYTES)
  })

  it('rejects an attachment over the byte ceiling', () => {
    expect(() =>
      v.parse(chatAttachmentSchema, attachment(0, MAX_CHAT_ATTACHMENT_BYTES + 1)),
    ).toThrow()
  })

  it('accepts a full batch and rejects one attachment past the count cap', () => {
    expect(v.parse(chatAttachmentsSchema, attachments(MAX_CHAT_ATTACHMENTS))).toHaveLength(
      MAX_CHAT_ATTACHMENTS,
    )
    expect(() => v.parse(chatAttachmentsSchema, attachments(MAX_CHAT_ATTACHMENTS + 1))).toThrow()
  })

  it('caps the upload batch that carries the bytes in from the client', () => {
    const uploads = attachments(MAX_CHAT_ATTACHMENTS + 1).map((entry) => ({
      ...entry,
      dataUrl: 'data:image/png;base64,AAAA',
    }))

    expect(() => v.parse(chatAttachmentUploadsSchema, uploads)).toThrow()
    expect(
      v.parse(chatAttachmentUploadsSchema, uploads.slice(0, MAX_CHAT_ATTACHMENTS)),
    ).toHaveLength(MAX_CHAT_ATTACHMENTS)
  })

  it('enforces both caps where a message declares its attachments', () => {
    const message = {
      id: 'msg-1',
      sessionId: '35ecdd23-f0b6-593a-8d5b-108982c1126d',
      role: 'user',
      text: 'look at these',
      turnId: null,
      streaming: false,
      createdAt: '2026-05-24T00:00:00.000Z',
      updatedAt: '2026-05-24T00:00:00.000Z',
    }

    expect(() =>
      v.parse(orchestrationMessageSchema, {
        ...message,
        attachments: attachments(MAX_CHAT_ATTACHMENTS + 1),
      }),
    ).toThrow()
    expect(() =>
      v.parse(orchestrationMessageSchema, {
        ...message,
        attachments: [attachment(0, MAX_CHAT_ATTACHMENT_BYTES + 1)],
      }),
    ).toThrow()
    expect(v.parse(orchestrationMessageSchema, message).attachments).toEqual([])
  })
})

describe('chat attachment blob urls', () => {
  it('addresses a stored blob by id and stored extension', () => {
    expect(chatAttachmentUrlPath({ type: 'image', id: 'image-a1b2', mimeType: 'image/png' })).toBe(
      `${CHAT_ATTACHMENT_URL_PREFIX}/image-a1b2.png`,
    )
    expect(chatAttachmentUrlPath({ type: 'image', id: 'image-a1b2', mimeType: 'IMAGE/JPEG' })).toBe(
      `${CHAT_ATTACHMENT_URL_PREFIX}/image-a1b2.jpg`,
    )
  })

  it('escapes an id that would otherwise reshape the url', () => {
    expect(chatAttachmentUrlPath({ type: 'image', id: '../evil', mimeType: 'image/png' })).toBe(
      `${CHAT_ATTACHMENT_URL_PREFIX}/..%2Fevil.png`,
    )
  })

  it('has no url for a type that was never written to the blob store', () => {
    expect(
      chatAttachmentUrlPath({ type: 'image', id: 'image-a1b2', mimeType: 'image/svg+xml' }),
    ).toBeNull()
    expect(chatAttachmentExtension('image/heic')).toBeNull()
    expect(chatAttachmentExtension('application/pdf')).toBeNull()
  })
})
