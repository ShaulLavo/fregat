// @vitest-environment node
import { createRequire } from 'node:module'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { Language, Parser } from 'web-tree-sitter'
import { analyzeLineMergeUnit } from '../src/treeSitter/mergeUnits'

const require = createRequire(import.meta.url)
const grammarRequire = createRequire(
  new URL('../../tree-sitter-languages/package.json', import.meta.url),
)
let parser: Parser

beforeAll(async () => {
  await Parser.init({ locateFile: () => require.resolve('web-tree-sitter/web-tree-sitter.wasm') })
  const language = await Language.load(
    grammarRequire.resolve('tree-sitter-typescript/tree-sitter-typescript.wasm'),
  )
  parser = new Parser()
  parser.setLanguage(language)
})

afterAll(() => parser?.delete())

it.each(['index', 'position'] as const)(
  'seeks a late child by %s in a large flat document',
  (mode) => {
    const declaration = 'const value = 1;\n'
    const text = declaration.repeat(100_000)
    const tree = parser.parse(text)!
    const cursor = tree.walk()
    try {
      expect(tree.rootNode.hasError).toBe(false)
      expect(tree.rootNode.childCount).toBe(100_000)
      expect(cursor.gotoFirstChild()).toBe(true)
      expect(cursor.startIndex).toBe(0)
      cursor.reset(tree.rootNode)
      const row = 98_000
      const startIndex = row * declaration.length
      const found =
        mode === 'index'
          ? cursor.gotoFirstChildForIndex(startIndex + 6)
          : cursor.gotoFirstChildForPosition({ row, column: 6 })
      expect(found).toBe(true)
      expect(cursor.nodeType).toBe('lexical_declaration')
      expect(cursor.startIndex).toBe(startIndex)
      expect(cursor.endIndex).toBe(startIndex + declaration.length - 1)
    } finally {
      cursor.delete()
      tree.delete()
    }
  },
  30_000,
)

it.each(['index', 'position'] as const)(
  'reports success for child zero and failure after the document by %s',
  (mode) => {
    const text = 'const first = 1;\nconst second = 2;\n'
    const tree = parser.parse(text)!
    const cursor = tree.walk()
    try {
      const first =
        mode === 'index'
          ? cursor.gotoFirstChildForIndex(0)
          : cursor.gotoFirstChildForPosition({ row: 0, column: 0 })
      expect(first).toBe(true)
      expect(cursor.startIndex).toBe(0)
      cursor.reset(tree.rootNode)
      const missing =
        mode === 'index'
          ? cursor.gotoFirstChildForIndex(text.length + 1)
          : cursor.gotoFirstChildForPosition({ row: 3, column: 0 })
      expect(missing).toBe(false)
      expect(cursor.nodeType).toBe('program')
    } finally {
      cursor.delete()
      tree.delete()
    }
  },
)

it('preserves inclusive error ranges at late siblings and EOF', () => {
  const prefix = 'const clean = 1;\n'.repeat(99_998)
  const text = prefix + 'const broken = ;\nconst final = "unterminated'
  const tree = parser.parse(text)!
  const cursor = tree.walk()
  const errors: { startIndex: number; endIndex: number }[] = []
  try {
    let depth = 0
    for (;;) {
      const node = cursor.currentNode
      if (node.isError || node.isMissing)
        errors.push({ startIndex: node.startIndex, endIndex: node.endIndex })
      if (node.hasError && cursor.gotoFirstChild()) {
        depth++
        continue
      }
      if (depth === 0) break
      if (cursor.gotoNextSibling()) continue
      while (cursor.gotoParent()) {
        depth--
        if (depth === 0 || cursor.gotoNextSibling()) break
      }
      if (depth === 0) break
    }
    expect(errors.length).toBeGreaterThan(0)
    const points = [0, prefix.length - 1, prefix.length, text.length].concat(
      errors.flatMap((error) => [
        error.startIndex - 1,
        error.startIndex,
        error.endIndex,
        error.endIndex + 1,
      ]),
    )
    for (const startIndex of points) {
      const unit = {
        source: 'line' as const,
        type: 'line',
        startIndex,
        endIndex: startIndex,
        signature: null,
        parent: null,
      }
      expect(analyzeLineMergeUnit(tree.rootNode, unit, { analysis: true }).hasErrors).toBe(
        errors.some((error) => error.endIndex >= startIndex && error.startIndex <= startIndex),
      )
    }
  } finally {
    cursor.delete()
    tree.delete()
  }
}, 30_000)
