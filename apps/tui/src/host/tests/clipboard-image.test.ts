import { MAX_CHAT_ATTACHMENT_BYTES } from '@workspace/contracts'
import { readClipboardImage } from '@/host/clipboard-image'
import { clipboardBoundary } from '../../../test/factories/clipboard'
import { test, expect } from '../../../test/fixtures'

test('clipboard images retain binary bytes, enforce the attachment limit, and dispose the host service', async () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 0, 255])
  const boundary = clipboardBoundary({
    status: 'read',
    representation: { mimeType: 'image/png', bytes },
  })
  const signal = new AbortController().signal
  const image = await readClipboardImage(signal, boundary.create)
  expect(image?.bytes).toBe(bytes)
  expect(image?.mimeType).toBe('image/png')
  expect(boundary.configurations).toEqual([{ maxReadBytes: MAX_CHAT_ATTACHMENT_BYTES }])
  expect(boundary.reads[0]?.signal).toBe(signal)
  expect(boundary.reads[0]?.preferredTypes).toContain('image/png')
  expect(boundary.disposed).toBe(true)
})

test('clipboard failures and oversized provider responses release the host service', async () => {
  const failure = clipboardBoundary({ status: 'unsupported' })
  await expect(readClipboardImage(new AbortController().signal, failure.create)).rejects.toThrow(
    'unsupported',
  )
  expect(failure.disposed).toBe(true)
  const oversized = clipboardBoundary({
    status: 'read',
    representation: { mimeType: 'image/png', bytes: new Uint8Array(MAX_CHAT_ATTACHMENT_BYTES + 1) },
  })
  await expect(readClipboardImage(new AbortController().signal, oversized.create)).rejects.toThrow(
    'too large',
  )
  expect(oversized.disposed).toBe(true)
})

test('a cancelled clipboard read returns without an attachment', async () => {
  const boundary = clipboardBoundary({ status: 'cancelled' })
  expect(await readClipboardImage(new AbortController().signal, boundary.create)).toBeNull()
  expect(boundary.disposed).toBe(true)
})
