import { expect, test } from '../../../../../test/fixtures'

import { MAX_CHAT_ATTACHMENT_BYTES, MAX_CHAT_ATTACHMENTS } from '@workspace/contracts'

import { MAX_CHAT_ATTACHMENT_ENCODED_BYTES } from '@workspace/client-core/chat/attachments'
import { chatAttachmentDataUrlLength } from '@workspace/client-core/chat/attachments'
import {
  classifyChatImageFile,
  MAX_COMPRESSIBLE_SOURCE_BYTES,
} from '@/features/chat/utils/input-attachment-limits'

// `size` is derived from the blob parts, so building a 50MB file just to test a
// threshold would allocate 50MB. Overriding the property is the cheap way to
// hand the classifier a file of an arbitrary reported size.
function imageFile(type: string, sizeBytes = 1024, name = 'shot.png') {
  const file = new File([new Uint8Array(1)], name, { type })
  Object.defineProperty(file, 'size', { value: sizeBytes })

  return file
}

test('accepts every media type the provider can actually read', () => {
  for (const mimeType of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
    expect(classifyChatImageFile(imageFile(mimeType), 0)).toEqual({
      status: 'accept',
      mimeType,
    })
  }
})

test('rejects a HEIC paste in the browser instead of failing the turn server-side', () => {
  expect(classifyChatImageFile(imageFile('image/heic'), 0)).toEqual({
    status: 'reject',
    reason: 'unsupported-type',
    message: 'PNG, JPEG, WebP and GIF only.',
  })
})

test('rejects SVG even though it matches the contract image/* regex', () => {
  expect(classifyChatImageFile(imageFile('image/svg+xml'), 0)).toEqual({
    status: 'reject',
    reason: 'unsupported-type',
    message: 'PNG, JPEG, WebP and GIF only.',
  })
})

test('rejects a file the OS gave no media type at all', () => {
  expect(classifyChatImageFile(imageFile(''), 0).status).toBe('reject')
})

test('normalizes the unregistered image/jpg some tools write', () => {
  expect(classifyChatImageFile(imageFile('image/jpg'), 0)).toEqual({
    status: 'accept',
    mimeType: 'image/jpeg',
  })
})

test('ignores media type parameters and casing', () => {
  expect(classifyChatImageFile(imageFile('IMAGE/PNG; charset=binary'), 0)).toEqual({
    status: 'accept',
    mimeType: 'image/png',
  })
})

test('accepts the last image under the count cap', () => {
  expect(classifyChatImageFile(imageFile('image/png'), MAX_CHAT_ATTACHMENTS - 1).status).toBe(
    'accept',
  )
})

test('rejects once the count cap is reached', () => {
  expect(classifyChatImageFile(imageFile('image/png'), MAX_CHAT_ATTACHMENTS)).toEqual({
    status: 'reject',
    reason: 'too-many',
    message: 'Up to 8 images per message.',
  })
})

test('the media type is checked before the count, so a HEIC names its real problem', () => {
  const classification = classifyChatImageFile(imageFile('image/heic'), MAX_CHAT_ATTACHMENTS)

  expect(classification.status === 'reject' && classification.reason).toBe('unsupported-type')
})

test('rejects an empty file rather than letting it fail to decode later', () => {
  expect(classifyChatImageFile(imageFile('image/png', 0), 0)).toEqual({
    status: 'reject',
    reason: 'empty',
    message: 'That image is empty.',
  })
})

test('accepts an oversize image so it can be downscaled instead of refused', () => {
  expect(
    classifyChatImageFile(imageFile('image/png', MAX_CHAT_ATTACHMENT_BYTES * 2), 0).status,
  ).toBe('accept')
})

test('accepts a source right at the compressible ceiling', () => {
  expect(
    classifyChatImageFile(imageFile('image/png', MAX_COMPRESSIBLE_SOURCE_BYTES), 0).status,
  ).toBe('accept')
})

test('rejects a source above the compressible ceiling, which is never safe to decode', () => {
  expect(
    classifyChatImageFile(imageFile('image/png', MAX_COMPRESSIBLE_SOURCE_BYTES + 1), 0),
  ).toEqual({
    status: 'reject',
    reason: 'too-large',
    message: 'Images must be under 50 MB.',
  })
})

test('the byte budget is set so the base64 payload fits the wire cap, not the raw bytes', () => {
  // What travels is the data URL, so compressing to MAX_CHAT_ATTACHMENT_BYTES
  // shipped ~13.7 MB under a 10 MB limit and passed validation, because
  // `sizeBytes` reports the pre-encoding size.
  expect(MAX_CHAT_ATTACHMENT_ENCODED_BYTES).toBeLessThan(MAX_CHAT_ATTACHMENT_BYTES)
  expect(
    chatAttachmentDataUrlLength(MAX_CHAT_ATTACHMENT_ENCODED_BYTES, 'image/webp'),
  ).toBeLessThanOrEqual(MAX_CHAT_ATTACHMENT_BYTES)
})

test('a blob at the old budget would have overflowed the wire cap', () => {
  expect(chatAttachmentDataUrlLength(MAX_CHAT_ATTACHMENT_BYTES, 'image/webp')).toBeGreaterThan(
    MAX_CHAT_ATTACHMENT_BYTES,
  )
})

test('the data URL length counts its own prefix', () => {
  // 3 bytes is exactly one base64 quantum, so the only variable left is the header.
  expect(chatAttachmentDataUrlLength(3, 'image/png')).toBe('data:image/png;base64,'.length + 4)
  expect(chatAttachmentDataUrlLength(0, 'image/png')).toBe('data:image/png;base64,'.length)
})
