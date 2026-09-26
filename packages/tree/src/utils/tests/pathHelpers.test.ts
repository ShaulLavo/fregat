import { describe, expect, it } from 'vitest'

import { getAncestorDirectoryPaths } from '../model/pathHelpers'

describe('getAncestorDirectoryPaths', () => {
  it.each([
    ['a/b/c', ['a/', 'a/b/']],
    ['a/b/c/', ['a/', 'a/b/']],
    ['/a/b', ['/', '/a/']],
    ['a//b', ['a/', 'a//']],
    ['a/', []],
    ['a', []],
    ['', []],
  ])('%j -> %j', (path, expected) => {
    expect(getAncestorDirectoryPaths(path)).toEqual(expected)
  })
})
