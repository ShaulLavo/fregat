import path from 'node:path'
import { expect, it } from 'vitest'
import { isInsidePath } from '../shared/boundary'

it('accepts a double-dot prefix while rejecting parents and sibling paths', () => {
  const root = path.resolve('/workspace/project')

  expect(isInsidePath(root, path.join(root, '..foo'))).toBe(true)
  expect(isInsidePath(root, path.dirname(root))).toBe(false)
  expect(isInsidePath(root, path.resolve(root, '../sibling'))).toBe(false)
  expect(isInsidePath(root, root)).toBe(true)
})
