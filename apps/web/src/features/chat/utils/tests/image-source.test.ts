import { expect, test } from '../../../../../test/fixtures'
import { normalizeImageSource } from '../image-source'

test('recognizes screenshot bytes with absent or misleading drag metadata', async () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])
  for (const type of ['', 'application/octet-stream', 'image/x-png']) {
    const normalized = await normalizeImageSource(new File([bytes], 'Screenshot', { type }))
    expect(normalized.type).toBe('image/png')
    expect(new Uint8Array(await normalized.arrayBuffer())).toEqual(bytes)
  }
})

test('recognizes HEIC and HEIF screenshot headers without an extension', async () => {
  for (const [brand, type] of [
    ['heic', 'image/heic'],
    ['mif1', 'image/heif'],
  ]) {
    const file = new File([`\u0000\u0000\u0000\u0018ftyp${brand}`], 'Screenshot')
    expect((await normalizeImageSource(file)).type).toBe(type)
  }
})

test('uses the image extension when drag metadata is missing', async () => {
  const file = new File(['image bytes'], 'Screenshot.HEIC')
  expect((await normalizeImageSource(file)).type).toBe('image/heic')
})

test('preserves a general file and its bytes', async () => {
  const file = new File(['notes'], 'notes.txt', { type: 'text/plain' })
  expect(await normalizeImageSource(file)).toBe(file)
})
