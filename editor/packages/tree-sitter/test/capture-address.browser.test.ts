import { expect, it } from 'vitest'
import { Language, Parser, Query, TextBuffer, heap } from 'web-tree-sitter'
import parserWasmUrl from 'web-tree-sitter/web-tree-sitter.wasm?url'
import { resolveTreeSitterLanguageContribution } from '../src'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '../../tree-sitter-languages/src/index'

it('decodes captures allocated above the signed Wasm address boundary', async () => {
  await Parser.init({ locateFile: () => parserWasmUrl })
  const descriptor = await resolveTreeSitterLanguageContribution(
    TREE_SITTER_LANGUAGE_CONTRIBUTIONS.find((language) => language.id === 'typescript')!,
  )
  const language = await Language.load(descriptor.wasmUrl)
  const parser = new Parser()
  parser.setLanguage(language)
  const text = 'const value = 1;\n'.repeat(50_000)
  const tree = parser.parse(text)!
  const query = new Query(language, '(identifier) @variable')
  const buffers: TextBuffer[] = []
  try {
    for (let index = 0; index < 3; index++) {
      const buffer = new TextBuffer()
      buffers.push(buffer)
      // Reserve native address space without building a multi-gigabyte JavaScript string.
      ;(buffer as unknown as { reserve(length: number): void }).reserve(400_000_000)
    }
    expect(heap().length).toBeGreaterThan(2 ** 31)
    expect(query.captures(tree.rootNode).length).toBe(50_000)
    expect(query.matches(tree.rootNode).length).toBe(50_000)
    const ranges = query.captureRanges(tree.rootNode)
    expect(ranges).toHaveLength(50_000)
    expect(ranges[0]).toMatchObject({ name: 'variable', startIndex: 6, endIndex: 11 })
    expect(ranges.at(-1)).toMatchObject({
      name: 'variable',
      startIndex: text.lastIndexOf('value'),
      endIndex: text.lastIndexOf('value') + 5,
    })
  } finally {
    for (const buffer of buffers) buffer.delete()
    query.delete()
    tree.delete()
    parser.delete()
  }
}, 120_000)
