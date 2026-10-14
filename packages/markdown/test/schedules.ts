import { ok } from 'node:assert/strict'

export type StreamFrame = { readonly offset: number; readonly text: string }
export type ChunkOptions = { readonly seed: number; readonly maxUnits: number }
export type ByteChunkOptions = { readonly seed: number; readonly maxBytes: number }

export function* everyPrefix(source: string): Iterable<StreamFrame> {
  yield { offset: 0, text: '' }
  let offset = 0
  for (const character of source) {
    offset += character.length
    yield { offset, text: source.slice(0, offset) }
  }
}

export function* adversarialUtf16(source: string): Iterable<StreamFrame> {
  for (let offset = 0; offset <= source.length; offset += 1) {
    yield { offset, text: source.slice(0, offset) }
  }
}

export function* seededChunks(source: string, options: ChunkOptions): Iterable<StreamFrame> {
  validateChunks(options.seed, options.maxUnits)
  const random = seededRandom(options.seed)
  yield { offset: 0, text: '' }
  let offset = 0
  while (offset < source.length) {
    offset = Math.min(source.length, offset + 1 + Math.floor(random() * options.maxUnits))
    if (splitsSurrogate(source, offset)) offset += 1
    yield { offset, text: source.slice(0, offset) }
  }
}

export function* utf8Chunks(source: string, options: ByteChunkOptions): Iterable<StreamFrame> {
  validateChunks(options.seed, options.maxBytes)
  const bytes = new TextEncoder().encode(source)
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  const random = seededRandom(options.seed)
  yield { offset: 0, text: '' }
  let text = ''
  let offset = 0
  while (offset < bytes.length) {
    const end = Math.min(bytes.length, offset + 1 + Math.floor(random() * options.maxBytes))
    text += decoder.decode(bytes.subarray(offset, end), { stream: true })
    offset = end
    yield { offset: text.length, text }
  }
  text += decoder.decode()
  ok(text === source, 'UTF-8 transport requires a source without unpaired surrogates')
  if (source.length > 0) yield { offset: text.length, text }
}

function validateChunks(seed: number, maximum: number): void {
  ok(Number.isInteger(seed), 'Chunk seed must be an integer')
  ok(Number.isSafeInteger(maximum) && maximum > 0, 'Chunk size must be a positive safe integer')
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

function splitsSurrogate(source: string, offset: number): boolean {
  const before = source.charCodeAt(offset - 1)
  const after = source.charCodeAt(offset)
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff
}
