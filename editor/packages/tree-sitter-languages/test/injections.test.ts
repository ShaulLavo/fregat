import { readFile } from 'node:fs/promises'
import { beforeAll, expect, it } from 'vitest'
import { Language, Parser, Query } from 'web-tree-sitter'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '../src/index'

beforeAll(() => Parser.init())

it.each(['javascript', 'typescript'])('injects only documentation comments in %s', async (id) => {
  const file = `../node_modules/tree-sitter-${id}/tree-sitter-${id}.wasm`
  const language = await Language.load(await readFile(new URL(file, import.meta.url)))
  const source = await readFile(
    new URL('../src/queries/javascript-injections.scm', import.meta.url),
    'utf8',
  )
  const parser = new Parser().setLanguage(language)
  const query = new Query(language, source)
  const text =
    '// ordinary comment\n/* ordinary block */\n/** @param {number} value */\nconst re = /[a-z]+/;'
  const tree = parser.parse(text)!
  try {
    const matches = query.matches(tree.rootNode)
    const docs = matches.filter((match) => match.setProperties?.['injection.language'] === 'jsdoc')
    expect(docs.map((match) => match.captures[0]!.node.text)).toEqual([
      '/** @param {number} value */',
    ])
    const regex = matches.filter((match) => match.setProperties?.['injection.language'] === 'regex')
    expect(regex.map((match) => match.captures[0]!.node.text)).toEqual(['[a-z]+'])
  } finally {
    tree.delete()
    query.delete()
    parser.delete()
  }
})

it.each([
  ['jsdoc', '/** @param {number} value description */'],
  ['regex', '[a-z]+'],
])('ships a usable lazy %s grammar and highlights', async (id, text) => {
  const contribution = TREE_SITTER_LANGUAGE_CONTRIBUTIONS.find((language) => language.id === id)
  expect(contribution).toBeDefined()
  const assets = await contribution!.load!()
  const language = await Language.load(
    await readFile(
      new URL(`../node_modules/tree-sitter-${id}/tree-sitter-${id}.wasm`, import.meta.url),
    ),
  )
  const parser = new Parser().setLanguage(language)
  const query = new Query(language, assets.highlightQuerySource!)
  const tree = parser.parse(text)!
  try {
    expect(tree.rootNode.hasError).toBe(false)
    expect(query.captures(tree.rootNode).length).toBeGreaterThan(0)
  } finally {
    tree.delete()
    query.delete()
    parser.delete()
  }
})
