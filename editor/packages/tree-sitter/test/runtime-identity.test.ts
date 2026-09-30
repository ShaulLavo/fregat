import { createRequire } from 'node:module'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const markdownRequire = createRequire(require.resolve('tree-sitter-md'))

it('shares the host runtime with the native markdown extension', () => {
  expect(markdownRequire.resolve('web-tree-sitter')).toBe(require.resolve('web-tree-sitter'))
})
