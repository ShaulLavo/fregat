import { describe, expect, it } from 'vitest'

import {
  resolveOverflowTextSplit,
  type OverflowTextSplitRule,
} from '@/features/workspace/utils/tree-overflow-text-split'

const SPACED_FALLBACK_NAMES = [
  'Hello world',
  'my file',
  'Hello world wide web',
  'a  double space',
] as const

describe('overflow text splitting', () => {
  it.each(SPACED_FALLBACK_NAMES)(
    'keeps whitespace away from the splitCenter seam for %s',
    (contents) => {
      const result = split(contents, 'center')

      expect(result.join('')).toBe(contents)
      expect(boundaryIsWhitespaceFree(result)).toBe(true)
    },
  )

  it.each(SPACED_FALLBACK_NAMES)(
    'keeps whitespace away from the splitExtension fallback seam for %s',
    (contents) => {
      const result = split(contents, 'extension')

      expect(result.join('')).toBe(contents)
      expect(boundaryIsWhitespaceFree(result)).toBe(true)
    },
  )

  it('keeps leading and trailing whitespace inside a segment', () => {
    expect(split(' abc', 'center')).toEqual([' a', 'bc'])
    expect(split('abc ', 'center')).toEqual(['ab', 'c '])
  })

  it('preserves extension splitting for spaced and multi-dot names', () => {
    expect(split('my file.txt', 'extension')).toEqual(['my file.', 'txt'])
    expect(split('archive.tar.gz', 'extension')).toEqual(['archive.tar.', 'gz'])
  })

  it('round-trips all-whitespace input when no clean boundary exists', () => {
    const result = split('    ', 'center')

    expect(result.join('')).toBe('    ')
    expect(result).toEqual(['  ', '  '])
  })

  it('splits leaf paths at the final slash within the leaf threshold', () => {
    expect(split('src/components/FileTree.tsx', 'leaf-path')).toEqual([
      'src/components/',
      'FileTree.tsx',
    ])
  })

  it('uses an explicit split index', () => {
    expect(split('abcdef', 2)).toEqual(['ab', 'cdef'])
  })

  it('splits by first and last offsets', () => {
    expect(split('abcdef', ['first', 2])).toEqual(['ab', 'cdef'])
    expect(split('abcdef', ['last', 2])).toEqual(['abcd', 'ef'])
  })

  it('falls back to the center for invalid offsets', () => {
    expect(split('abcdef', ['first', 0])).toEqual(['abc', 'def'])
    expect(split('abcdef', ['last', 6])).toEqual(['abc', 'def'])
  })
})

function split(contents: string, rule: OverflowTextSplitRule): [string, string] {
  const resolution = resolveOverflowTextSplit(rule)
  return resolution.split(contents, resolution)
}

function boundaryIsWhitespaceFree([first, second]: [string, string]): boolean {
  return !isWhitespace(first.at(-1)) && !isWhitespace(second[0])
}

function isWhitespace(character: string | undefined): boolean {
  return character != null && /\s/.test(character)
}
