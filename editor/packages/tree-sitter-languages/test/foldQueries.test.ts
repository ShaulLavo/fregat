import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { beforeAll, expect, it } from 'vitest'
import { Language, Parser, Query } from 'web-tree-sitter'
import { createPieceTableSnapshot } from '../../editor/src/public/document'
import { bufferPointToFoldPoint, createFoldMap } from '../../editor/src/foldMap'
import { JAVASCRIPT_TREE_SITTER_LANGUAGE, TYPESCRIPT_TREE_SITTER_LANGUAGE } from '../src'

const require = createRequire(import.meta.url)
const text = readFileSync(new URL('./fixtures/eslint.config.txt', import.meta.url), 'utf8')

beforeAll(async () => {
  await Parser.init()
})

it.each([
  {
    contribution: JAVASCRIPT_TREE_SITTER_LANGUAGE,
    wasm: 'tree-sitter-javascript/tree-sitter-javascript.wasm',
  },
  {
    contribution: TYPESCRIPT_TREE_SITTER_LANGUAGE,
    wasm: 'tree-sitter-typescript/tree-sitter-typescript.wasm',
  },
])(
  'keeps array and object folds in a $contribution.id config file',
  async ({ contribution, wasm }) => {
    const assets = await contribution.load!()
    const language = await Language.load(require.resolve(wasm))
    const parser = new Parser()
    parser.setLanguage(language)
    const tree = parser.parse(text)!
    const query = new Query(language, assets.foldQuerySource!)
    try {
      const folds = query
        .captures(tree.rootNode)
        .map(({ node }) => ({
          startIndex: node.startIndex,
          endIndex: node.endIndex,
          startLine: node.startPosition.row,
          endLine: node.endPosition.row,
          type: node.type,
        }))
        .filter((fold) => fold.endLine > fold.startLine)
      expect([...new Set(folds.map((fold) => fold.startLine + 1))]).toEqual([8, 10, 12, 18, 21])
      const outer = folds.find((fold) => fold.startLine === 7)!
      expect(outer.type).toBe('array')
      expect(outer.endLine).toBe(25)
      expect(folds.some((fold) => fold.type === 'arguments')).toBe(false)
      const collapsed = createFoldMap(createPieceTableSnapshot(text), [outer])
      expect(bufferPointToFoldPoint(collapsed, { row: 8, column: 2 }).row).toBe(7)
      expect(bufferPointToFoldPoint(collapsed, { row: 9, column: 2 }).row).toBe(7)
      expect(bufferPointToFoldPoint(collapsed, { row: 24, column: 2 }).row).toBe(7)
    } finally {
      query.delete()
      tree.delete()
      parser.delete()
    }
  },
)
