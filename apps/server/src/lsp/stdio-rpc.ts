import type { Writable } from 'node:stream'

const HEADER_SEPARATOR = '\r\n\r\n'
const HEADER_SEPARATOR_BYTES = Buffer.byteLength(HEADER_SEPARATOR)
const INITIAL_HEADER_CAPACITY = 256

// Headers are tens of bytes. A server that never sends a separator would
// otherwise grow this buffer without limit, so cap it and treat the overflow as
// a malformed frame rather than a leak.
const MAX_HEADER_BYTES = 8 * 1024

// A body no allocator can represent is unframeable by any implementation, so
// rejecting it here is a correctness floor rather than a product limit. The
// configurable per-server ceiling is separate work.
const MAX_BODY_BYTES = 2 ** 31 - 1

export type LspStdioMessageHandler = (message: string, byteLength: number) => void

export type LspStdioFramingStats = {
  readonly chunkCount: number
  readonly discardedBytes: number
  readonly malformedCount: number
  readonly maxMessageBytes: number
}

/**
 * Reads `Content-Length` framed messages from a child process's stdout.
 *
 * Each body is assembled exactly once, into a buffer sized from its own header:
 * chunks are copied straight to their final offset and never re-copied. The
 * previous implementation concatenated the whole pending message per chunk,
 * which is quadratic — a 4 MiB body arriving in 16 KiB reads copied 518 MiB.
 *
 * The header region is contiguous by construction, so a separator split across
 * two chunks needs no resumable scan cursor: it is always findable in the
 * accumulated header alone.
 */
export class LspStdioMessageReader {
  private header = Buffer.allocUnsafe(INITIAL_HEADER_CAPACITY)
  private headerLength = 0
  private body: Buffer | null = null
  private bodyFilled = 0
  private chunkCount = 0
  private discardedBytes = 0
  private malformedCount = 0
  private maxMessageBytes = 0
  private readonly onMessage: LspStdioMessageHandler

  constructor(onMessage: LspStdioMessageHandler) {
    this.onMessage = onMessage
  }

  get stats(): LspStdioFramingStats {
    return {
      chunkCount: this.chunkCount,
      discardedBytes: this.discardedBytes,
      malformedCount: this.malformedCount,
      maxMessageBytes: this.maxMessageBytes,
    }
  }

  push(chunk: Buffer | Uint8Array | string) {
    const bytes = asBuffer(chunk)
    this.chunkCount += 1

    let offset = 0
    while (offset < bytes.length) {
      offset = this.consume(bytes, offset)
    }
  }

  private consume(bytes: Buffer, offset: number) {
    if (this.body === null) return this.fillHeader(bytes, offset)

    return this.fillBody(bytes, offset)
  }

  /**
   * Copies chunk bytes into the header until the separator appears. Bytes taken
   * past the separator belong to the body, so the returned offset rewinds to
   * exactly where the header ended and the next loop pass assembles them.
   */
  private fillHeader(bytes: Buffer, offset: number) {
    const scanFrom = Math.max(0, this.headerLength - (HEADER_SEPARATOR_BYTES - 1))
    const take = Math.min(bytes.length - offset, MAX_HEADER_BYTES - this.headerLength)
    this.appendHeader(bytes, offset, take)

    const separatorAt = this.header
      .subarray(0, this.headerLength)
      .indexOf(HEADER_SEPARATOR, scanFrom, 'ascii')
    if (separatorAt === -1) return this.headerWithoutSeparator(offset, take)

    const bodyStart = separatorAt + HEADER_SEPARATOR_BYTES
    const consumed = offset + take - (this.headerLength - bodyStart)
    const contentLength = contentLengthFromHeaders(
      this.header.subarray(0, separatorAt).toString('ascii'),
    )
    if (contentLength === null || contentLength > MAX_BODY_BYTES) {
      this.malformedCount += 1
      this.discardHeader(bodyStart)
      return consumed
    }

    this.discardHeader(0)
    this.body = Buffer.allocUnsafe(contentLength)
    this.bodyFilled = 0
    this.flushCompleteBody()
    return consumed
  }

  private headerWithoutSeparator(offset: number, take: number) {
    if (this.headerLength < MAX_HEADER_BYTES) return offset + take

    // No separator within the cap: the stream is not framed the way we expect.
    // Drop what we hold and resynchronise on the following bytes.
    this.malformedCount += 1
    this.discardHeader(this.headerLength)
    return offset + take
  }

  private fillBody(bytes: Buffer, offset: number) {
    const body = this.body
    if (body === null) return offset

    const take = Math.min(body.length - this.bodyFilled, bytes.length - offset)
    bytes.copy(body, this.bodyFilled, offset, offset + take)
    this.bodyFilled += take
    this.flushCompleteBody()
    return offset + take
  }

  /** Resets before handing the message out, so a reentrant `push` is safe. */
  private flushCompleteBody() {
    const body = this.body
    if (body === null || this.bodyFilled < body.length) return

    this.body = null
    this.bodyFilled = 0
    this.maxMessageBytes = Math.max(this.maxMessageBytes, body.length)
    this.onMessage(body.toString('utf8'), body.length)
  }

  private appendHeader(bytes: Buffer, offset: number, length: number) {
    this.growHeader(this.headerLength + length)
    bytes.copy(this.header, this.headerLength, offset, offset + length)
    this.headerLength += length
  }

  private growHeader(needed: number) {
    if (needed <= this.header.length) return

    let capacity = this.header.length
    while (capacity < needed) capacity *= 2

    const grown = Buffer.allocUnsafe(capacity)
    this.header.copy(grown, 0, 0, this.headerLength)
    this.header = grown
  }

  private discardHeader(discardedBytes: number) {
    this.discardedBytes += discardedBytes
    this.headerLength = 0
  }
}

export function encodeLspStdioMessage(message: string) {
  return `Content-Length: ${Buffer.byteLength(message, 'utf8')}\r\n\r\n${message}`
}

export function writeLspStdioMessage(stream: Writable, message: string) {
  stream.write(encodeLspStdioMessage(message))
}

function asBuffer(chunk: Buffer | Uint8Array | string) {
  if (typeof chunk === 'string') return Buffer.from(chunk, 'utf8')
  if (Buffer.isBuffer(chunk)) return chunk

  // A view, not a copy: the bytes are copied to their final offset by the
  // caller and this wrapper is never retained.
  return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
}

function contentLengthFromHeaders(headers: string) {
  for (const line of headers.split('\r\n')) {
    const match = /^Content-Length:\s*(\d+)$/iu.exec(line)
    if (!match) continue

    return Number.parseInt(match[1] ?? '', 10)
  }

  return null
}
