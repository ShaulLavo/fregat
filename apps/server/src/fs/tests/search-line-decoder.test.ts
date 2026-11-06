import { Readable } from 'node:stream'

import { test, expect } from 'vitest'
import { streamLines } from '../search-line-decoder'

test('decodes physical lines with split UTF-8 and CRLF bytes', async () => {
  const bytes = Buffer.from('café\r\n😀 needle\nlast')
  const chunks = Array.from(bytes, (byte) => Buffer.from([byte]))
  const lines = await Array.fromAsync(streamLines(Readable.from(chunks), bytes.length))

  expect(lines).toEqual([
    { text: 'café', byteLength: 5, terminatorLength: 2 },
    { text: '😀 needle', byteLength: 11, terminatorLength: 1 },
    { text: 'last', byteLength: 4, terminatorLength: 0 },
  ])
})

test('counts CRLF toward the byte limit and keeps only complete lines before it', async () => {
  const bytes = Buffer.from('é\r\n😀\r\nlast')
  const chunks = [bytes.subarray(0, 9), bytes.subarray(9)]

  const lines = await Array.fromAsync(streamLines(Readable.from(chunks), 9))

  expect(lines).toEqual([{ text: 'é', byteLength: 2, terminatorLength: 2 }])
})

test('does not turn the content limit into an end-of-line anchor', async () => {
  const lines = await Array.fromAsync(streamLines(Readable.from([Buffer.from('needle more')]), 6))

  expect(lines).toEqual([])
})

test('stops pulling an unterminated line at the content limit and closes its source', async () => {
  let pulls = 0
  const stream = new Readable({
    highWaterMark: 1,
    read() {
      pulls += 1
      this.push(Buffer.alloc(65_536, 0x20))
    },
  })

  try {
    const lines = await Array.fromAsync(streamLines(stream, 131_072))

    expect(lines).toEqual([])
    expect(pulls).toBeLessThanOrEqual(4)
    expect(stream.destroyed).toBe(true)
  } finally {
    stream.destroy()
  }
})
