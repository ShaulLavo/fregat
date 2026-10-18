import { expect } from 'vitest'
import { TextBuffer, heap } from 'web-tree-sitter'
import { MarkdownDocument, memoryBytes } from 'tree-sitter-md'

export function verifySharedHeapGrowth() {
  const document = new MarkdownDocument()
  let buffer: TextBuffer | undefined
  try {
    const text = '# שלום 🪐\n\nA **bold** paragraph.\n'
    document.setText(text)
    const highlights = document.highlights(0, text.length)
    const decorations = document.decorations(0, text.length)
    const retainedHighlights = highlights.slice()
    const semantics = document.semantics()
    expect(semantics.root).toBeDefined()
    expect(highlights.length).toBeGreaterThan(0)
    const before = heap()
    const bytes = before.buffer.byteLength
    const bounded = before.subarray(0, 16)
    const prefix = bounded.slice()
    expect(before.byteOffset).toBe(0)
    expect(before.byteLength).toBe(bytes)
    expect(memoryBytes()).toBe(bytes)
    expect(bytes).toBeLessThanOrEqual(32 * 1024 * 1024)
    buffer = new TextBuffer('x'.repeat(bytes))
    const current = heap()
    expect(buffer.slice(0, 8)).toBe('xxxxxxxx')
    expect(current === before).toBe(true)
    expect(current.buffer === before.buffer).toBe(true)
    expect(before.byteLength).toBeGreaterThan(bytes)
    expect(before.byteLength).toBe(before.buffer.byteLength)
    expect(before.byteLength % 65_536).toBe(0)
    expect(memoryBytes()).toBe(before.byteLength)
    expect(bounded.byteLength).toBe(16)
    expect(bounded).toEqual(prefix)
    expect(before.subarray(bytes).includes('x'.charCodeAt(0))).toBe(true)
    expect(buffer.slice(bytes - 8)).toBe('xxxxxxxx')
    expect(document.semantics()).toEqual(semantics)
    expect(document.highlights(0, text.length)).toEqual(highlights)
    expect(document.decorations(0, text.length)).toEqual(decorations)
    document.edit(0, 0, '漢字 🦀\n\n')
    const edited = '漢字 🦀\n\n' + text
    const fresh = new MarkdownDocument()
    try {
      fresh.setText(edited)
      expect(document.highlights(0, edited.length)).toEqual(fresh.highlights(0, edited.length))
      expect(document.decorations(0, edited.length)).toEqual(fresh.decorations(0, edited.length))
      expect(document.semantics().root).toEqual(fresh.semantics().root)
      document.reparse()
      expect(document.decorations(0, edited.length)).toEqual(fresh.decorations(0, edited.length))
      expect(highlights).toEqual(retainedHighlights)
    } finally {
      fresh.dispose()
    }
  } finally {
    buffer?.delete()
    document.dispose()
  }
  expect(memoryBytes()).toBe(heap().byteLength)
}
