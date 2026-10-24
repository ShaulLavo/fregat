import { readFile } from 'node:fs/promises'
import { beforeAll, expect, it } from 'vitest'
import { Language, Parser, Query } from 'web-tree-sitter'
import {
  styleForTreeSitterCapture,
  treeSitterCapturesToEditorTokens,
} from '@singapore-editor/core/syntax'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '../src/index'
import { SQL_CATEGORIES, SQL_FIXTURE } from './fixtures/sql'

beforeAll(() => Parser.init())

it('paints SQL categories without treating numeric literals as strings', async () => {
  const language = await Language.load(
    await readFile(new URL('../src/grammars/tree-sitter-sql.wasm', import.meta.url)),
  )
  const assets = await TREE_SITTER_LANGUAGE_CONTRIBUTIONS.find((language) => language.id === 'sql')!
    .load!()
  const parser = new Parser().setLanguage(language)
  const query = new Query(language, assets.highlightQuerySource!)
  const tree = parser.parse(SQL_FIXTURE)!
  try {
    expect(tree.rootNode.hasError).toBe(false)
    const captures = query.captures(tree.rootNode).map(({ name, node }) => ({
      captureName: name,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }))
    const tokens = treeSitterCapturesToEditorTokens(captures)
    for (const [text, category] of SQL_CATEGORIES) {
      const start = SQL_FIXTURE.indexOf(text)
      const token = tokens.find((token) => token.start <= start && token.end >= start + text.length)
      expect(token?.style, text).toEqual(styleForTreeSitterCapture(category))
    }
    const numbers = captures.filter((capture) => capture.captureName === 'number')
    expect(numbers.length).toBeGreaterThan(8)
    expect(
      numbers.some((number) =>
        captures.some(
          (capture) => capture.captureName === 'string' && capture.startIndex === number.startIndex,
        ),
      ),
    ).toBe(false)
  } finally {
    tree.delete()
    query.delete()
    parser.delete()
  }
})
