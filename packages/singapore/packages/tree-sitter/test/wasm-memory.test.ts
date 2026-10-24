// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { expect, it } from 'vitest'
import { Language, Parser, heap } from 'web-tree-sitter'
import { init, memoryBytes } from 'tree-sitter-md'
import { verifySharedHeapGrowth } from './fixtures/wasm-memory'

it('keeps the actual shared parser heap attached after allocation and disposal', async () => {
  const require = createRequire(import.meta.url)
  expect(memoryBytes()).toBe(0)
  expect(() => heap()).toThrow(TypeError)
  await Parser.init({ locateFile: () => require.resolve('web-tree-sitter/web-tree-sitter.wasm') })
  expect(memoryBytes()).toBe(0)
  const grammar = await Language.load(
    await readFile(require.resolve('tree-sitter-md/tree-sitter-markdown.wasm')),
  )
  await init({
    grammar,
    resolver: await readFile(require.resolve('tree-sitter-md/tree-sitter-md.wasm')),
  })
  verifySharedHeapGrowth()
})
