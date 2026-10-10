import { init, MarkdownDocument, CAPTURES } from 'tree-sitter-md'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, expect, it } from 'vitest'
import { Language, Parser, Query } from 'web-tree-sitter'
import { styleForTreeSitterCapture } from '@singapore-editor/core/syntax'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '../src/index'
import { NATIVE_FIXTURES } from './fixtures/native'
import { TREE_SITTER_LANGUAGE_METADATA } from '../src/metadata'

const manifest = JSON.parse(await readFile(new URL('../languages.json', import.meta.url), 'utf8'))
const root = new URL('..', import.meta.url).pathname
beforeAll(() => Parser.init())

it.each(TREE_SITTER_LANGUAGE_CONTRIBUTIONS)(
  'admits $id queries against the shipped WASM',
  async (contribution) => {
    const entry = manifest.languages.find((entry: { id: string }) => entry.id === contribution.id)
    // NOT-PORTABLE: Grammar assets assume package-local node_modules rather than resolution.
    const path = resolve(root, entry.wasm.startsWith('.') ? 'src' : 'node_modules', entry.wasm)
    const language = await Language.load(await readFile(path))
    const assets = await contribution.load!()
    for (const [kind, source] of Object.entries(assets)) {
      if (kind === 'wasmUrl' || !source) continue
      admitQuery(language, kind, source, contribution.id)
    }
  },
)

function admitQuery(language: Language, kind: string, source: string, id: string) {
  expect(source).not.toMatch(/;\s*inherits\s*:/)
  // Only the web-tree-sitter predicates and the injection properties we consume are admitted.
  const operations = Array.from(source.matchAll(/#([\w-]+[?!])/g), (match) => match[1])
  expect(
    operations.every((operation) =>
      ['eq?', 'not-eq?', 'match?', 'not-match?', 'any-of?', 'not-any-of?', 'set!']
        .concat(['javascript', 'typescript', 'tsx'].includes(id) ? ['is-not?'] : [])
        .includes(operation!),
    ),
  ).toBe(true)
  const query = new Query(language, source)
  try {
    if (kind === 'highlightQuerySource') assertCaptureStyles(query.captureNames)
    for (const properties of query.setProperties) {
      expect(
        Object.keys(properties ?? {}).every((key) =>
          ['injection.language', 'injection.combined', 'injection.include-children'].includes(key),
        ),
      ).toBe(true)
    }
    expect(query.assertedProperties.filter(Boolean)).toEqual([])
    const refuted = query.refutedProperties.filter(Boolean)
    // Existing JS queries require locals. Keep this recorded gap out of verified coverage.
    if (['javascript', 'typescript', 'tsx'].includes(id)) {
      expect(
        refuted.every((properties) => Object.keys(properties).every((key) => key === 'local')),
      ).toBe(true)
    } else {
      expect(refuted).toEqual([])
    }
  } finally {
    query.delete()
  }
}

function assertCaptureStyles(names: readonly string[]) {
  for (const name of names) {
    if (name.startsWith('_') || name === 'none' || name === 'embedded') continue
    expect(styleForTreeSitterCapture(name), `Unmapped capture: ${name}`).not.toBeNull()
  }
}

it('keeps TypeScript and TSX separate and drops the ambiguous react alias', () => {
  const ts = TREE_SITTER_LANGUAGE_METADATA.find((language) => language.id === 'typescript')!
  const tsx = TREE_SITTER_LANGUAGE_METADATA.find((language) => language.id === 'tsx')!
  expect(ts.extensions).toEqual(['.cts', '.mts', '.ts'])
  expect(tsx.extensions).toEqual(['.tsx'])
  expect(TREE_SITTER_LANGUAGE_METADATA.flatMap((language) => [...language.aliases])).not.toContain(
    'react',
  )
})

it('captures Astro markup and discovers all embedded regions with the real parser', async () => {
  const language = await Language.load(
    await readFile(resolve(root, 'src/grammars/tree-sitter-astro.wasm')),
  )
  const contribution = TREE_SITTER_LANGUAGE_CONTRIBUTIONS.find(
    (language) => language.id === 'astro',
  )!
  const assets = await contribution.load!()
  const parser = new Parser().setLanguage(language)
  const highlights = new Query(language, assets.highlightQuerySource!)
  const injections = new Query(language, assets.injectionQuerySource!)
  const source =
    '---\r\nconst title: string = "שלום 🪐"\r\n---\r\n<!-- greeting -->\n<Card title={title}>{title}</Card>\n<script>const n = 1</script>\n<style>h1 { color: red }</style>\n'
  const tree = parser.parse(source)!
  try {
    expect(tree.rootNode.hasError).toBe(false)
    const captures = highlights.captures(tree.rootNode)
    expect(captures.some((capture) => capture.name === 'tag' && capture.node.text === 'Card')).toBe(
      true,
    )
    expect(captures.some((capture) => capture.name === 'comment')).toBe(true)
    const matches = injections.matches(tree.rootNode)
    expect(matches.map((match) => match.setProperties?.['injection.language'])).toEqual([
      'typescript',
      'typescript',
      'typescript',
      'typescript',
      'css',
    ])
  } finally {
    tree.delete()
    highlights.delete()
    injections.delete()
    parser.delete()
  }
})

it.each(NATIVE_FIXTURES)('checks curated categories and malformed $id source', async (fixture) => {
  if (fixture.id === 'markdown') {
    await init()
    const document = new MarkdownDocument()
    document.setText(fixture.text)
    const highlights = document.highlights(0, fixture.text.length)
    const names = [...highlights]
      .filter((_, index) => index % 3 === 2)
      .map((index) => CAPTURES[index])
    for (const name of fixture.captures) expect(names).toContain(name)
    document.setText(fixture.text.slice(0, -5))
    expect(() => document.highlights(0, fixture.text.length - 5)).not.toThrow()
    document.dispose()
    return
  }
  const contribution = TREE_SITTER_LANGUAGE_CONTRIBUTIONS.find(
    (language) => language.id === fixture.id,
  )!
  const entry = manifest.languages.find((entry: { id: string }) => entry.id === fixture.id)
  const language = await Language.load(
    await readFile(resolve(root, entry.wasm.startsWith('.') ? 'src' : 'node_modules', entry.wasm)),
  )
  const assets = await contribution.load!()
  const parser = new Parser().setLanguage(language)
  const query = new Query(language, assets.highlightQuerySource!)
  try {
    assertFixture(parser, query, fixture.text, fixture.captures)
    const incomplete = parser.parse(fixture.text.slice(0, -5))!
    expect(() => query.captures(incomplete.rootNode)).not.toThrow()
    incomplete.delete()
  } finally {
    parser.delete()
    query.delete()
  }
})

function assertFixture(parser: Parser, query: Query, text: string, expected: readonly string[]) {
  const tree = parser.parse(text)!
  try {
    expect(tree.rootNode.hasError).toBe(false)
    const names = query.captures(tree.rootNode).map((capture) => capture.name)
    for (const name of expected) expect(names).toContain(name)
  } finally {
    tree.delete()
  }
}
