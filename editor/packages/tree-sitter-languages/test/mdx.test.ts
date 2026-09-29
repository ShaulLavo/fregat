import { readFile } from 'node:fs/promises'
import { beforeAll, expect, it } from 'vitest'
import { Language, Parser, Query } from 'web-tree-sitter'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '../src/index'
import { MDX_FIXTURE } from './fixtures/mdx'

beforeAll(() => Parser.init())

it.each([
  ['# {title}\n', 'atx_heading', 'jsx_expression', '{title}'],
  ['Hello <Badge /> world\n', 'paragraph', 'jsx_self_closing_element', '<Badge />'],
  ['שלום 🪐 {user.name}!\n', 'paragraph', 'jsx_expression', '{user.name}'],
  ['## Hello <Badge /> {title}\r\n', 'atx_heading', 'jsx_expression', '{title}'],
])('keeps inline MDX inside its containing block: %s', async (text, parent, kind, value) => {
  const language = await loadLanguage()
  const parser = new Parser().setLanguage(language)
  const tree = parser.parse(text!)!
  try {
    expect(tree.rootNode.hasError).toBe(false)
    const node = tree.rootNode.descendantsOfType(kind!)[0]!
    expect(node.parent?.type).toBe(parent)
    expect(node.text).toBe(value)
    expect([node.startIndex, node.endIndex]).toEqual([
      text!.indexOf(value!),
      text!.indexOf(value!) + value!.length,
    ])
    const prose = tree.rootNode.descendantsOfType('markdown_inline')
    expect(
      prose.every((part) => part.endIndex <= node.startIndex || part.startIndex >= node.endIndex),
    ).toBe(true)
  } finally {
    tree.delete()
    parser.delete()
  }
})

it('keeps multiline prose in one inline injection around JSX boundaries', async () => {
  const language = await loadLanguage()
  const parser = new Parser().setLanguage(language)
  const tree = parser.parse('**Across\nlines** <Badge /> tail\nmore text\n')!
  try {
    expect(tree.rootNode.hasError).toBe(false)
    expect(tree.rootNode.descendantsOfType('markdown_inline').map((node) => node.text)).toEqual([
      '**Across\nlines** ',
      ' tail\nmore text',
    ])
  } finally {
    tree.delete()
    parser.delete()
  }
})

it('admits the mixed fixture and keeps locals-dependent builtin names ordinary', async () => {
  const language = await loadLanguage()
  const assets = await TREE_SITTER_LANGUAGE_CONTRIBUTIONS.find((entry) => entry.id === 'mdx')!
    .load!()
  const parser = new Parser().setLanguage(language)
  const query = new Query(language, assets.highlightQuerySource!)
  const tree = parser.parse(MDX_FIXTURE + '\n{((console) => console.log(1))(value)}\n')!
  try {
    expect(tree.rootNode.hasError).toBe(false)
    const captures = query.captures(tree.rootNode)
    expect(
      captures.filter((capture) => capture.node.text === 'console').map((capture) => capture.name),
    ).toEqual(['variable', 'variable'])
    expect(
      captures.some((capture) => capture.name === 'constructor' && capture.node.text === 'Badge'),
    ).toBe(true)
    expect(
      captures.some(
        (capture) => capture.name === 'text.literal' && capture.node.text.includes('SELECT'),
      ),
    ).toBe(false)
  } finally {
    tree.delete()
    query.delete()
    parser.delete()
  }
})

async function loadLanguage() {
  return Language.load(
    await readFile(new URL('../src/grammars/tree-sitter-mdx.wasm', import.meta.url)),
  )
}
