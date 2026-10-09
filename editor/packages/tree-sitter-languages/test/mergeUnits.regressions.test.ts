import { createRequire } from 'node:module'
import { beforeAll, expect, it } from 'vitest'
import { Language, Parser, Query } from 'web-tree-sitter'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '../src/catalog.generated'
import { enclosingMergeUnit } from '../../tree-sitter/src/treeSitter/mergeUnits'

const require = createRequire(import.meta.url)
const fixtures = [
  ...(['javascript', 'typescript', 'tsx'] as const).flatMap((id) => [
    {
      name: `${id} import aliases identify distinct local bindings`,
      id,
      text: 'import { pigment as amber, pigment as violet } from "paint";',
      needles: ['amber', 'violet'],
      signatures: ['amber', 'violet'],
      type: 'import_specifier',
      parent: 'named_imports',
      commutative: true,
    },
    {
      name: `${id} import aliases identify duplicate local bindings`,
      id,
      text: 'import { warm as shade, cool as shade } from "paint";',
      needles: ['shade', 'shade'],
      signatures: ['shade', 'shade'],
      type: 'import_specifier',
      parent: 'named_imports',
      commutative: true,
    },
  ]),
  {
    name: 'static and instance methods stay ordered',
    id: 'javascript',
    text: 'class Brush { static tint(x) {} tint(y) {} }',
    needles: ['tint', 'tint'],
    signatures: ['tint', 'tint'],
    type: 'method_definition',
    parent: 'class_body',
    commutative: false,
  },
  {
    name: 'complementary accessors stay ordered',
    id: 'javascript',
    text: 'class Brush { get tint() { return 1; } set tint(value) {} }',
    needles: ['tint', 'tint'],
    signatures: ['tint', 'tint'],
    type: 'method_definition',
    parent: 'class_body',
    commutative: false,
  },
  {
    name: 'duplicate methods stay ordered',
    id: 'javascript',
    text: 'class Brush { tint(x) {} tint(y) {} }',
    needles: ['tint', 'tint'],
    signatures: ['tint', 'tint'],
    type: 'method_definition',
    parent: 'class_body',
    commutative: false,
  },
  {
    name: 'every grouped Go field remains identifiable beside duplicate declarations',
    id: 'go',
    text: 'package paint\ntype Palette struct { Amber, Violet int; Amber int; Violet int }\n',
    needles: ['Amber', 'Violet', 'Amber', 'Violet'],
    signatures: ['Amber', 'Violet', 'Amber', 'Violet'],
    type: 'field_identifier',
    parent: 'field_declaration',
    commutative: false,
  },
  {
    name: 'TypeScript interface overload order is preserved',
    id: 'typescript',
    text: 'interface Brush { tint(x: string): "warm"; tint(x: string | number): "cool"; }',
    needles: ['tint', 'tint'],
    signatures: ['tint', 'tint'],
    type: 'method_signature',
    parent: 'interface_body',
    commutative: false,
  },
  {
    name: 'comments preserve property-only interface eligibility',
    id: 'typescript',
    text: 'interface Palette { amber: string; /* hue */ violet: number; }',
    needles: ['amber', 'violet'],
    signatures: ['amber', 'violet'],
    type: 'property_signature',
    parent: 'interface_body',
    commutative: true,
  },
  {
    name: 'decorator expression order is preserved',
    id: 'javascript',
    text: 'class Brush { @paint("warm") amber() {} @paint("cool") violet() {} }',
    needles: ['amber()', 'violet()'],
    signatures: ['amber', 'violet'],
    type: 'method_definition',
    parent: 'class_body',
    commutative: false,
  },
  {
    name: 'ordinary commented methods stay ordered',
    id: 'javascript',
    text: 'class Brush { amber() {} /* hue */ violet() {} }',
    needles: ['amber', 'violet'],
    signatures: ['amber', 'violet'],
    type: 'method_definition',
    parent: 'class_body',
    commutative: false,
  },
  {
    name: 'JavaScript property enumeration order is preserved',
    id: 'javascript',
    text: 'const palette = { amber: 1, violet: 2 }; Object.keys(palette);',
    needles: ['1', '2'],
    signatures: ['amber', 'violet'],
    type: 'pair',
    parent: 'object',
    commutative: false,
  },
  {
    name: 'Go fields used in positional composite literals stay ordered',
    id: 'go',
    text: 'package brush\ntype Palette struct { Amber int; Violet int }\nvar color = Palette{1, 2}\n',
    needles: ['int', 'int'],
    signatures: [null, null],
    type: 'field_declaration',
    parent: 'field_declaration_list',
    commutative: false,
  },
  {
    name: 'Rust C-layout fields stay ordered',
    id: 'rust',
    text: '#[repr(C)] struct Palette { amber: u8, violet: u32 }',
    needles: ['amber', 'violet'],
    signatures: ['amber', 'violet'],
    type: 'field_declaration',
    parent: 'field_declaration_list',
    commutative: false,
  },
  {
    name: 'Rust fields with destruction stay ordered',
    id: 'rust',
    text: 'struct Guard; impl Drop for Guard { fn drop(&mut self) {} }\nstruct Palette { amber: Guard, violet: Guard }',
    needles: ['amber', 'violet'],
    signatures: ['amber', 'violet'],
    type: 'field_declaration',
    parent: 'field_declaration_list',
    commutative: false,
  },
] as const

beforeAll(() => Parser.init())

it.each(fixtures)('$name', async (fixture) => {
  const assets = await TREE_SITTER_LANGUAGE_CONTRIBUTIONS.find((entry) => entry.id === fixture.id)!
    .load!()
  const wasm = {
    javascript: 'tree-sitter-javascript/tree-sitter-javascript.wasm',
    typescript: 'tree-sitter-typescript/tree-sitter-typescript.wasm',
    tsx: 'tree-sitter-typescript/tree-sitter-tsx.wasm',
    go: 'tree-sitter-go/tree-sitter-go.wasm',
    rust: 'tree-sitter-rust/tree-sitter-rust.wasm',
  }[fixture.id]!
  const language = await Language.load(require.resolve(wasm))
  const parser = new Parser().setLanguage(language)
  const tree = parser.parse(fixture.text)!
  const query = new Query(language, assets.mergeUnitQuerySource!)
  try {
    expect(tree.rootNode.hasError).toBe(false)
    let cursor = 0
    const units = fixture.needles.map((needle, index) => {
      const startIndex = fixture.text.indexOf(needle, cursor)
      expect(startIndex).toBeGreaterThanOrEqual(0)
      cursor = startIndex + needle.length
      const unit = enclosingMergeUnit(tree.rootNode, query, { startIndex, endIndex: cursor })
      expect(unit).toMatchObject({
        source: 'syntax',
        type: fixture.type,
        signature: fixture.signatures[index],
        parent: { type: fixture.parent, commutative: fixture.commutative },
      })
      expect(unit!.startIndex).toBeLessThanOrEqual(startIndex)
      expect(unit!.endIndex).toBeGreaterThanOrEqual(cursor)
      return unit!
    })
    if (fixture.id === 'go' && fixture.needles.length === 4) {
      expect(units[0]!.parent).toEqual(units[1]!.parent)
      expect(units[0]!.signature).toBe(units[2]!.signature)
      expect(units[1]!.signature).toBe(units[3]!.signature)
      expect(units[0]!.startIndex).not.toBe(units[1]!.startIndex)
    }
  } finally {
    query.delete()
    tree.delete()
    parser.delete()
  }
})
