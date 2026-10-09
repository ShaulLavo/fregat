import { createRequire } from 'node:module'
import { beforeAll, expect, it } from 'vitest'
import { Language, Parser, Query } from 'web-tree-sitter'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '../src/catalog.generated'
import { enclosingMergeUnit } from '../../tree-sitter/src/treeSitter/mergeUnits'

const require = createRequire(import.meta.url)
const fixtures = [
  {
    id: 'javascript',
    wasm: 'tree-sitter-javascript/tree-sitter-javascript.wasm',
    text: 'import { amber, violet } from "paint";\nfunction mix() { return amber; }',
    needle: 'amber',
    type: 'import_specifier',
    signature: 'amber',
    commutative: true,
  },
  {
    id: 'typescript',
    wasm: 'tree-sitter-typescript/tree-sitter-typescript.wasm',
    text: 'interface Palette { amber: string; violet: number; }',
    needle: 'amber',
    type: 'property_signature',
    signature: 'amber',
    commutative: true,
  },
  {
    id: 'tsx',
    wasm: 'tree-sitter-typescript/tree-sitter-tsx.wasm',
    text: 'function Swatch() { return <Tile shade="amber" />; }',
    needle: 'shade',
    type: 'jsx_attribute',
    signature: 'shade',
    commutative: false,
  },
  {
    id: 'json',
    wasm: 'tree-sitter-json/tree-sitter-json.wasm',
    text: '{"amber": 3, "violet": [4, 5]}',
    needle: '3',
    type: 'pair',
    signature: '"amber"',
    commutative: true,
  },
  {
    id: 'css',
    wasm: 'tree-sitter-css/tree-sitter-css.wasm',
    text: '.swatch { color: amber; padding: 2px; }',
    needle: 'amber',
    type: 'declaration',
    signature: 'color',
    commutative: false,
  },
  {
    id: 'markdown',
    wasm: 'tree-sitter-md/tree-sitter-markdown.wasm',
    text: '# Swatches\n\nAmber is warm.\n\n- Violet\n- Indigo\n',
    needle: 'warm',
    type: 'paragraph',
    signature: null,
    commutative: false,
  },
  {
    id: 'python',
    wasm: 'tree-sitter-python/tree-sitter-python.wasm',
    text: 'def mix(shade):\n    return shade + 1\n',
    needle: 'return',
    type: 'return_statement',
    signature: null,
    commutative: false,
  },
  {
    id: 'rust',
    wasm: 'tree-sitter-rust/tree-sitter-rust.wasm',
    text: 'struct Palette { amber: u8, violet: u8 }',
    needle: 'amber',
    type: 'field_declaration',
    signature: 'amber',
    commutative: false,
  },
  {
    id: 'go',
    wasm: 'tree-sitter-go/tree-sitter-go.wasm',
    text: 'package paint\ntype Palette struct { Amber int; Violet int }\n',
    needle: 'Amber',
    type: 'field_identifier',
    signature: 'Amber',
    commutative: false,
  },
  {
    id: 'javascript',
    wasm: 'tree-sitter-javascript/tree-sitter-javascript.wasm',
    text: 'class Brush { amber() {} violet() {} }',
    needle: 'amber',
    type: 'method_definition',
    signature: 'amber',
    commutative: false,
  },
  {
    id: 'javascript',
    wasm: 'tree-sitter-javascript/tree-sitter-javascript.wasm',
    text: 'class Brush { amber() {} shade = use(); violet() {} }',
    needle: 'amber',
    type: 'method_definition',
    signature: 'amber',
    commutative: false,
  },
  {
    id: 'javascript',
    wasm: 'tree-sitter-javascript/tree-sitter-javascript.wasm',
    text: 'const paint = { amber: 2, violet: 3 };',
    needle: '2',
    type: 'pair',
    signature: 'amber',
    commutative: false,
  },
  {
    id: 'javascript',
    wasm: 'tree-sitter-javascript/tree-sitter-javascript.wasm',
    text: 'const paint = { amber: 2, violet: use(), indigo: 3 };',
    needle: '2',
    type: 'pair',
    signature: 'amber',
    commutative: false,
  },
  {
    id: 'javascript',
    wasm: 'tree-sitter-javascript/tree-sitter-javascript.wasm',
    text: 'const paint = { amber: 2, ...base, indigo: 3 };',
    needle: '2',
    type: 'pair',
    signature: 'amber',
    commutative: false,
  },
  {
    id: 'javascript',
    wasm: 'tree-sitter-javascript/tree-sitter-javascript.wasm',
    text: 'const paint = { amber: 2, [use()]: 3 };',
    needle: '2',
    type: 'pair',
    signature: 'amber',
    commutative: false,
  },
  {
    id: 'javascript',
    wasm: 'tree-sitter-javascript/tree-sitter-javascript.wasm',
    text: 'class Brush { amber() {} [use()]() {} }',
    needle: 'amber',
    type: 'method_definition',
    signature: 'amber',
    commutative: false,
  },
  {
    id: 'typescript',
    wasm: 'tree-sitter-typescript/tree-sitter-typescript.wasm',
    text: 'function tint(shade: string) { return shade; }',
    needle: 'tint',
    type: 'function_declaration',
    signature: 'tint',
    commutative: false,
  },
  {
    id: 'tsx',
    wasm: 'tree-sitter-typescript/tree-sitter-tsx.wasm',
    text: 'const tile = <Tile shade="amber" />;',
    needle: '<Tile',
    type: 'jsx_self_closing_element',
    signature: null,
    commutative: false,
  },
  {
    id: 'json',
    wasm: 'tree-sitter-json/tree-sitter-json.wasm',
    text: '[2, 4, 6]',
    needle: '4',
    type: 'number',
    signature: null,
    commutative: false,
  },
  {
    id: 'css',
    wasm: 'tree-sitter-css/tree-sitter-css.wasm',
    text: '.swatch { color: amber; padding: 2px; }',
    needle: '.swatch',
    type: 'rule_set',
    signature: null,
    commutative: false,
  },
  {
    id: 'markdown',
    wasm: 'tree-sitter-md/tree-sitter-markdown.wasm',
    text: '# Swatches\n\n- Violet\n- Indigo\n',
    needle: '- Violet',
    type: 'list_item',
    signature: null,
    commutative: false,
  },
  {
    id: 'python',
    wasm: 'tree-sitter-python/tree-sitter-python.wasm',
    text: 'def mix(shade):\n    return shade + 1\n',
    needle: 'mix',
    type: 'function_definition',
    signature: 'mix',
    commutative: false,
  },
  {
    id: 'rust',
    wasm: 'tree-sitter-rust/tree-sitter-rust.wasm',
    text: 'fn tint(shade: u8) -> u8 { shade }',
    needle: 'tint',
    type: 'function_item',
    signature: 'tint',
    commutative: false,
  },
  {
    id: 'go',
    wasm: 'tree-sitter-go/tree-sitter-go.wasm',
    text: 'package paint\nimport ("fmt"; "os")\n',
    needle: '"fmt"',
    type: 'import_spec',
    signature: '"fmt"',
    commutative: true,
  },
  {
    id: 'python',
    wasm: 'tree-sitter-python/tree-sitter-python.wasm',
    text: 'from palette import amber, violet\n',
    needle: 'amber',
    type: 'dotted_name',
    signature: 'amber',
    commutative: false,
  },
  {
    id: 'rust',
    wasm: 'tree-sitter-rust/tree-sitter-rust.wasm',
    text: 'use palette::{amber, violet};',
    needle: 'amber',
    type: 'identifier',
    signature: 'amber',
    commutative: true,
  },
  {
    id: 'go',
    wasm: 'tree-sitter-go/tree-sitter-go.wasm',
    text: 'package paint\ntype Shade int\n',
    needle: 'Shade',
    type: 'type_spec',
    signature: 'Shade',
    commutative: false,
  },
] as const

beforeAll(() => Parser.init())

it.each(fixtures)('finds a merge unit with the shipped $id grammar', async (fixture) => {
  const assets = await TREE_SITTER_LANGUAGE_CONTRIBUTIONS.find((entry) => entry.id === fixture.id)!
    .load!()
  expect(assets.mergeUnitQuerySource).toBeTruthy()
  const language = await Language.load(require.resolve(fixture.wasm))
  const parser = new Parser().setLanguage(language)
  const tree = parser.parse(fixture.text)!
  const query = new Query(language, assets.mergeUnitQuerySource!)
  try {
    expect(tree.rootNode.hasError).toBe(false)
    expect(
      query.captureNames.every((name) =>
        ['merge.unit', 'merge.commutative', 'merge.signature', '_merge.member'].includes(name),
      ),
    ).toBe(true)
    const startIndex = fixture.text.indexOf(fixture.needle)
    const unit = enclosingMergeUnit(tree.rootNode, query, {
      startIndex,
      endIndex: startIndex + fixture.needle.length,
    })
    expect(unit).toMatchObject({
      source: 'syntax',
      type: fixture.type,
      signature: fixture.signature,
      parent: { commutative: fixture.commutative },
    })
    expect(unit!.startIndex).toBeLessThanOrEqual(startIndex)
    expect(unit!.endIndex).toBeGreaterThanOrEqual(startIndex + fixture.needle.length)
  } finally {
    query.delete()
    tree.delete()
    parser.delete()
  }
})
