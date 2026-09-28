import { expect, test } from 'vitest'
import { decodeText, isByteExactText, isValidUtf8 } from './text-encoding'
import { createFileResponse, decodeFileResponse } from './file-response'

const encoder = new TextEncoder()

test('decodes multibyte characters, BOMs and malformed sequences across chunk boundaries', () => {
  const prefix = 'a'.repeat(1024 * 1024 - 1)
  const text = '\uFEFF' + prefix + '😀é終' + prefix + 'tail'
  expect(decodeText(encoder.encode(text))).toMatchObject({ content: text, lossy: false })
  const malformed = encoder.encode(prefix + 'aaaaend')
  malformed[1024 * 1024 - 1] = 0xf0
  malformed[1024 * 1024] = 0x9f
  expect(decodeText(malformed)).toMatchObject({
    content: new TextDecoder('utf-8', { ignoreBOM: true }).decode(malformed),
    lossy: true,
  })
  expect(isByteExactText(malformed)).toBe(false)
})

test('preserves UTF-16 BOMs and isolated surrogate code units without Buffer', () => {
  expect(decodeText(new Uint8Array([0xff, 0xfe, 0x00, 0xd8, 0x41, 0x00, 0x42]))).toMatchObject({
    content: '\uFEFF\uD800A',
    encoding: 'utf16le',
    lossy: true,
  })
  expect(decodeText(new Uint8Array([0xfe, 0xff, 0xd8, 0x00, 0x00, 0x41, 0x42]))).toMatchObject({
    content: '\uFEFF\uD800A',
    encoding: 'utf16be',
    lossy: true,
  })
})

test('validates incoming UTF-8 independently of the file encoding heuristic', () => {
  const bytes = encoder.encode('a\0b\0')
  expect(isValidUtf8(bytes)).toBe(true)
  expect(isByteExactText(bytes)).toBe(false)
  expect(isValidUtf8(new Uint8Array([0xff]))).toBe(false)
})

test('round trips encoded metadata and rejects a truncated download', async () => {
  const metadata = {
    path: 'שלום/文 %.txt',
    size: 4,
    mtimeMs: 100.5,
    version: `sha256:${'a'.repeat(64)}`,
  }
  const response = createFileResponse(encoder.encode('text'), metadata)
  expect(decodeFileResponse(await response.arrayBuffer(), response.headers)).toMatchObject({
    ...metadata,
    content: 'text',
  })
  expect(() => decodeFileResponse(encoder.encode('tex').buffer, response.headers)).toThrow(
    'The file download was incomplete.',
  )
})
