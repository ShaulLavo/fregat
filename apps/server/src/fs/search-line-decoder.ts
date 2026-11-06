import type { Readable } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'

export const SEARCH_LINE_BUFFER_BYTES = 65_536

type StreamedLine = {
  text: string
  byteLength: number
  terminatorLength: number
}

type LineByteState = {
  pending: Buffer[]
  byteLength: number
}

const LINE_FEED = 0x0a
const CARRIAGE_RETURN = 0x0d

export async function* readLines(stream: NodeJS.ReadableStream | null): AsyncGenerator<string> {
  if (!stream) return

  const decoder = new StringDecoder('utf8')
  let buffered = ''

  for await (const chunk of stream) {
    buffered += decodeChunk(decoder, chunk)
    const lines = buffered.split(/\r?\n/u)
    buffered = lines.pop() ?? ''

    for (const line of lines) yield line
  }

  buffered += decoder.end()
  if (buffered) yield buffered
}

export async function* streamLines(
  stream: Readable,
  maxContentBytes: number,
): AsyncGenerator<StreamedLine> {
  const state: LineByteState = { pending: [], byteLength: 0 }
  let bytesRead = 0

  for await (const chunk of stream) {
    const bytes = toBuffer(chunk)
    const remainingBytes = maxContentBytes - bytesRead
    yield* streamChunkLines(state, bytes.subarray(0, remainingBytes))
    bytesRead += bytes.length
    // A file can grow after stat. A budget boundary is not a physical line ending.
    if (bytesRead > maxContentBytes) return
  }

  if (state.byteLength > 0) yield consumeLine(state, Buffer.alloc(0), false)
}

export function collectDecodedStreamTail(
  stream: NodeJS.ReadableStream | null | undefined,
  maxLength = 4_000,
) {
  const decoder = new StringDecoder('utf8')
  let tail = ''
  let ended = false

  const finish = () => {
    if (ended) return
    ended = true
    tail = appendTail(tail, decoder.end(), maxLength)
  }

  stream?.on('data', (chunk) => {
    tail = appendTail(tail, decodeChunk(decoder, chunk), maxLength)
  })
  stream?.once('end', finish)
  stream?.once('close', finish)

  return () => {
    finish()
    return tail.trim()
  }
}

function* streamChunkLines(state: LineByteState, chunk: Buffer): Generator<StreamedLine> {
  let remaining = chunk

  while (remaining.length > 0) {
    const lfIndex = remaining.indexOf(LINE_FEED)

    if (lfIndex === -1) {
      appendPending(state, remaining)
      return
    }

    yield consumeLine(state, remaining.subarray(0, lfIndex), true)
    remaining = remaining.subarray(lfIndex + 1)
  }
}

function consumeLine(state: LineByteState, chunk: Buffer, terminated: boolean): StreamedLine {
  appendPending(state, chunk)
  const bytes =
    state.pending.length <= 1
      ? (state.pending[0] ?? Buffer.alloc(0))
      : Buffer.concat(state.pending, state.byteLength)
  const hasCr = terminated && bytes[bytes.length - 1] === CARRIAGE_RETURN
  state.pending = []
  state.byteLength = 0

  const terminatorLength = terminated ? 1 + Number(hasCr) : 0
  return streamedLine(hasCr ? bytes.subarray(0, -1) : bytes, terminatorLength)
}

function streamedLine(bytes: Buffer, terminatorLength: number): StreamedLine {
  return {
    byteLength: bytes.length,
    terminatorLength,
    text: decodeBuffer(bytes),
  }
}

function appendPending(state: LineByteState, chunk: Buffer) {
  if (chunk.length === 0) return

  state.pending.push(chunk)
  state.byteLength += chunk.length
}

function appendTail(tail: string, text: string, maxLength: number) {
  return `${tail}${text}`.slice(-maxLength)
}

function decodeBuffer(buffer: Buffer) {
  const decoder = new StringDecoder('utf8')
  return decoder.write(buffer) + decoder.end()
}

function decodeChunk(decoder: StringDecoder, chunk: unknown) {
  return decoder.write(toBuffer(chunk))
}

function toBuffer(chunk: unknown) {
  if (Buffer.isBuffer(chunk)) return chunk
  if (typeof chunk === 'string') return Buffer.from(chunk)
  if (chunk instanceof Uint8Array) return Buffer.from(chunk)

  return Buffer.from(`${chunk}`)
}
