import { describe, expect, it } from 'vitest'

import {
  ancestorDirectoryPaths,
  isDirectoryPath,
  isSameOrInside,
  parentDirectoryPath,
} from '../slash-paths'

describe('ancestorDirectoryPaths', () => {
  it.each([
    ['', []],
    ['README.md', []],
    ['src/', []],
    ['src/a.ts', ['src/']],
    ['src/lib/a.ts', ['src/', 'src/lib/']],
    ['/a/b', ['/', '/a/']],
    ['a//b', ['a/', 'a//']],
    // A flattened chain is keyed by its terminal directory; each link is an ancestor.
    ['lonely/chain/of/single/', ['lonely/', 'lonely/chain/', 'lonely/chain/of/']],
  ] as const)('%j has ancestors %j', (path, ancestors) => {
    expect(ancestorDirectoryPaths(path)).toEqual(ancestors)
  })
})

describe('parentDirectoryPath', () => {
  it.each([
    ['', null],
    ['README.md', null],
    ['src/', null],
    ['src/a.ts', 'src/'],
    ['src/lib/', 'src/'],
  ] as const)('%j has parent %j', (path, parent) => {
    expect(parentDirectoryPath(path)).toBe(parent)
  })
})

it('treats only a trailing slash as a directory key', () => {
  expect(isDirectoryPath('src/')).toBe(true)
  expect(isDirectoryPath('src')).toBe(false)
  expect(isDirectoryPath('')).toBe(false)
})

it('contains a path in itself and its descendants only', () => {
  expect(isSameOrInside('src/a.ts', 'src')).toBe(true)
  expect(isSameOrInside('src', 'src')).toBe(true)
  expect(isSameOrInside('srcs/a.ts', 'src')).toBe(false)
})
