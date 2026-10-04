// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { expect, it } from 'vitest'
import { Language, Parser, TextBuffer, heap } from 'web-tree-sitter'
import { init, MarkdownDocument, memoryBytes } from 'tree-sitter-md'

it('refreshes the actual shared parser heap after allocation and disposal', async () => {
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
  const document = new MarkdownDocument()
  const text = '# Heading\n\nA **bold** paragraph.\n'
  document.setText(text)
  expect(document.highlights(0, text.length).length).toBeGreaterThan(0)
  const before = heap()
  const bytes = before.buffer.byteLength
  expect(before.byteOffset).toBe(0)
  expect(before.byteLength).toBe(bytes)
  expect(memoryBytes()).toBe(bytes)
  expect(bytes).toBeLessThanOrEqual(32 * 1024 * 1024)
  const buffer = new TextBuffer('x'.repeat(bytes))
  const current = heap()
  try {
    expect(buffer.slice(0, 8)).toBe('xxxxxxxx')
    expect(current.buffer.byteLength).toBeGreaterThan(bytes)
    expect(current.buffer === before.buffer).toBe(false)
    expect(before.byteLength).toBe(0)
    expect(memoryBytes()).toBe(current.buffer.byteLength)
    expect(current.buffer.byteLength % 65_536).toBe(0)
  } finally {
    buffer.delete()
    document.dispose()
  }
  expect(heap().buffer.byteLength).toBe(current.buffer.byteLength)
  expect(memoryBytes()).toBe(current.buffer.byteLength)
})
