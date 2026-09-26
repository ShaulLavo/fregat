import { describe, expect, it } from 'vitest'

import { resolveDraggedPathsForStart } from '../model/dragAndDrop'

describe('resolveDraggedPathsForStart', () => {
  it.each([
    ['src/a.ts', ['src/', 'src/a.ts', 'src/lib/b.ts'], ['src/']],
    ['src/a.ts', ['src/a.ts', 'src/lib/', 'src/lib/b.ts'], ['src/a.ts', 'src/lib/']],
    ['a.ts', ['src/', 'a.ts', 'src/'], ['src/', 'a.ts']],
    ['src/lib/', ['src/lib/', 'src/libx/c.ts'], ['src/lib/', 'src/libx/c.ts']],
    ['a.ts', ['src/'], ['a.ts']],
  ])('%j with %j -> %j', (path, selected, expected) => {
    expect(resolveDraggedPathsForStart(path, selected)).toEqual(expected)
  })
})
