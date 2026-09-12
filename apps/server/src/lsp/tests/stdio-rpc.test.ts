import { describe, expect, it } from 'vitest'

import { encodeLspStdioMessage, LspStdioMessageReader } from '../stdio-rpc'

function collect() {
  const messages: string[] = []
  const byteLengths: number[] = []
  const reader = new LspStdioMessageReader((message, byteLength) => {
    messages.push(message)
    byteLengths.push(byteLength)
  })

  return { byteLengths, messages, reader }
}

describe('LSP stdio framing', () => {
  it('decodes complete framed messages', () => {
    const { messages, reader } = collect()

    reader.push(encodeLspStdioMessage('{"jsonrpc":"2.0","method":"initialized"}'))

    expect(messages).toEqual(['{"jsonrpc":"2.0","method":"initialized"}'])
  })

  it('buffers partial messages and drains multiple frames', () => {
    const { messages, reader } = collect()
    const first = encodeLspStdioMessage('{"id":1,"result":null}')
    const second = encodeLspStdioMessage('{"id":2,"result":true}')
    const combined = first + second

    reader.push(combined.slice(0, 15))
    reader.push(combined.slice(15))

    expect(messages).toEqual(['{"id":1,"result":null}', '{"id":2,"result":true}'])
  })

  it('reports the body byte length, which differs from string length for non-ASCII', () => {
    const { byteLengths, messages, reader } = collect()

    reader.push(encodeLspStdioMessage('{"s":"日本語"}'))

    expect(messages).toEqual(['{"s":"日本語"}'])
    expect(byteLengths).toEqual([Buffer.byteLength('{"s":"日本語"}', 'utf8')])
    expect(byteLengths[0]).toBeGreaterThan(messages[0]?.length ?? 0)
  })

  it('finds a header separator split across two chunks', () => {
    const { messages, reader } = collect()
    const framed = encodeLspStdioMessage('{"id":3}')
    const separatorAt = framed.indexOf('\r\n\r\n')

    reader.push(framed.slice(0, separatorAt + 2))
    reader.push(framed.slice(separatorAt + 2))

    expect(messages).toEqual(['{"id":3}'])
  })

  it('delivers a frame whose body ends mid-chunk and starts the next frame from the remainder', () => {
    const { messages, reader } = collect()
    const combined = encodeLspStdioMessage('{"id":4}') + encodeLspStdioMessage('{"id":5}')

    reader.push(combined)

    expect(messages).toEqual(['{"id":4}', '{"id":5}'])
  })

  it('reassembles a body delivered one byte at a time', () => {
    const { messages, reader } = collect()
    const framed = Buffer.from(encodeLspStdioMessage('{"id":6,"v":"ab"}'), 'utf8')

    for (const byte of framed) reader.push(Buffer.from([byte]))

    expect(messages).toEqual(['{"id":6,"v":"ab"}'])
  })

  it('delivers an empty body', () => {
    const { byteLengths, messages, reader } = collect()

    reader.push(encodeLspStdioMessage(''))

    expect(messages).toEqual([''])
    expect(byteLengths).toEqual([0])
  })

  // Discarding a bad header block must not strand a complete frame behind it.
  it('discards a header block with no Content-Length and still delivers the frame behind it', () => {
    const { messages, reader } = collect()

    reader.push(`X-Bogus: 1\r\n\r\n${encodeLspStdioMessage('{"id":7}')}`)

    expect(messages).toEqual(['{"id":7}'])
    expect(reader.stats.malformedCount).toBe(1)
    expect(reader.stats.discardedBytes).toBe(Buffer.byteLength('X-Bogus: 1\r\n\r\n'))
  })

  it('accepts string and Uint8Array chunks', () => {
    const { messages, reader } = collect()
    const framed = encodeLspStdioMessage('{"id":8}')
    const bytes = new Uint8Array(Buffer.from(framed, 'utf8'))

    reader.push(framed.slice(0, 10))
    reader.push(bytes.subarray(10))

    expect(messages).toEqual(['{"id":8}'])
  })

  it('counts chunks and the largest frame so a log line can show the framing cost', () => {
    const { reader } = collect()
    const small = encodeLspStdioMessage('{"id":9}')
    const large = encodeLspStdioMessage(`{"id":10,"v":"${'x'.repeat(4096)}"}`)

    // Largest is not last, or the assertion cannot tell `max` from `body.length`.
    reader.push(large.slice(0, 40))
    reader.push(large.slice(40))
    reader.push(small)

    expect(reader.stats.chunkCount).toBe(3)
    expect(reader.stats.maxMessageBytes).toBe(
      Buffer.byteLength(`{"id":10,"v":"${'x'.repeat(4096)}"}`),
    )
    expect(reader.stats.malformedCount).toBe(0)
  })

  // Bounded memory, not recovery: unframed bytes are dropped a header-cap at a
  // time. Recovery follows only because this input ends on a cap boundary.
  it('drops unframed bytes at the header cap instead of buffering without limit', () => {
    const { messages, reader } = collect()
    const garbage = 8 * 1024 * 2

    reader.push('n'.repeat(garbage))

    expect(reader.stats.discardedBytes).toBe(garbage)
    expect(reader.stats.malformedCount).toBe(2)
    expect(messages).toEqual([])

    reader.push(encodeLspStdioMessage('{"id":11}'))

    expect(messages).toEqual(['{"id":11}'])
  })
})
