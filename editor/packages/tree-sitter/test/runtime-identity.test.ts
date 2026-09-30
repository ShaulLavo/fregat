import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const markdownRequire = createRequire(require.resolve('tree-sitter-md'))

it('shares the host runtime with the native markdown extension', () => {
  expect(markdownRequire.resolve('web-tree-sitter')).toBe(require.resolve('web-tree-sitter'))
})

it('initializes Markdown with a host-loaded grammar', () => {
  const fixture = resolve(import.meta.dirname, 'fixtures/runtime.mjs')
  expect(() => execFileSync('node', [fixture], { stdio: 'pipe' })).not.toThrow()
})
