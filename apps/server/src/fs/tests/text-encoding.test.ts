import { describe, expect, it } from 'vitest'
import { decodeText, detectTextEncoding, isByteExactText } from '../text-encoding'

const utf8 = (input: string) => new Uint8Array(Buffer.from(input, 'utf8'))
const utf16le = (input: string) => new Uint8Array(Buffer.from(input, 'utf16le'))
const utf16be = (input: string) => new Uint8Array(Buffer.from(input, 'utf16le').swap16())

describe('detectTextEncoding', () => {
  it('reads plain UTF-8 as UTF-8 text', () => {
    expect(detectTextEncoding(utf8('hello'))).toEqual({ encoding: 'utf8', seemsBinary: false })
  })

  it('reads a UTF-8 BOM as UTF-8 rather than as a zero-byte signal', () => {
    expect(detectTextEncoding(utf8('﻿hello'))).toEqual({
      encoding: 'utf8',
      seemsBinary: false,
    })
  })

  it('separates UTF-16 from binary by which parity the NUL bytes land on', () => {
    expect(detectTextEncoding(utf16le('hello'))).toEqual({
      encoding: 'utf16le',
      seemsBinary: false,
    })
    expect(detectTextEncoding(utf16be('hello'))).toEqual({
      encoding: 'utf16be',
      seemsBinary: false,
    })
  })

  it('calls a file binary when its NUL bytes fit neither UTF-16 parity', () => {
    expect(detectTextEncoding(utf8('left\0right'))).toEqual({
      encoding: 'utf8',
      seemsBinary: true,
    })
  })

  it('ignores NUL bytes past the first 512, the way VS Code does', () => {
    const bytes = new Uint8Array(600).fill(0x61)
    bytes[550] = 0

    expect(detectTextEncoding(bytes).seemsBinary).toBe(false)
  })

  it('reads malformed UTF-8 with no NUL as ordinary text', () => {
    expect(detectTextEncoding(new Uint8Array([0x66, 0x80, 0x6f]))).toEqual({
      encoding: 'utf8',
      seemsBinary: false,
    })
  })
})

describe('decodeText', () => {
  it('never throws on malformed input and reports the substitution', () => {
    expect(decodeText(new Uint8Array([0x66, 0x80, 0x6f]))).toMatchObject({
      content: 'f�o',
      lossy: true,
    })
  })

  it('keeps a leading BOM as U+FEFF so the round-trip policy still sees it', () => {
    expect(decodeText(utf8('﻿hello'))).toMatchObject({ content: '﻿hello', lossy: false })
  })

  it('decodes both UTF-16 byte orders, and calls them lossy because writes go out as UTF-8', () => {
    expect(decodeText(utf16le('﻿hi'))).toMatchObject({
      content: '﻿hi',
      encoding: 'utf16le',
      lossy: true,
    })
    expect(decodeText(utf16be('﻿hi'))).toMatchObject({
      content: '﻿hi',
      encoding: 'utf16be',
      lossy: true,
    })
  })

  it('decodes a binary-looking file rather than refusing it', () => {
    expect(decodeText(utf8('left\0right'))).toMatchObject({
      content: 'left\0right',
      lossy: false,
      seemsBinary: true,
    })
  })

  it('does not mistake a real U+FFFD in the source for a substitution', () => {
    expect(decodeText(utf8('a�b'))).toMatchObject({ content: 'a�b', lossy: false })
  })

  it('leaves the caller buffer untouched when byte-swapping UTF-16BE', () => {
    const bytes = utf16be('hi')
    const before = [...bytes]
    decodeText(bytes)

    expect([...bytes]).toEqual(before)
  })
})

describe('isByteExactText', () => {
  it('accepts text that re-encodes to the same bytes', () => {
    expect(isByteExactText(utf8('hello'))).toBe(true)
    expect(isByteExactText(utf8('﻿hello'))).toBe(true)
    expect(isByteExactText(utf8('left\0right'))).toBe(true)
  })

  it('rejects bytes a save would rewrite', () => {
    expect(isByteExactText(new Uint8Array([0x66, 0x80, 0x6f]))).toBe(false)
    expect(isByteExactText(utf16le('hello'))).toBe(false)
    expect(isByteExactText(utf16be('hello'))).toBe(false)
  })
})
