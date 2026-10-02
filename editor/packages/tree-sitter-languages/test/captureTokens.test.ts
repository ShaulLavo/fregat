import { readFile } from 'node:fs/promises'
import { beforeAll, describe, expect, it } from 'vitest'
import { Language, Parser, Query } from 'web-tree-sitter'
import { init, MarkdownDocument, CAPTURES } from 'tree-sitter-md'

import type { EditorSyntaxCapture, EditorToken } from '@singapore-editor/core/syntax'
import {
  styleForTreeSitterCapture,
  treeSitterCapturesToEditorTokens,
} from '@singapore-editor/core/syntax'

/**
 * Capture-to-token conversion against the grammars and queries this package actually ships.
 *
 * Hand-written capture fixtures cannot answer the question these tests ask. The defect is that
 * several shipped rules match the same span, and a fixture can only ever contain the overlaps its
 * author already thought of — running the real queries is what catches the ones nobody enumerated.
 */
// NOT-PORTABLE: Query and dependency paths assume package cwd and local node_modules.
const queriesDir = `${process.cwd()}/src/queries/`
const modulesDir = `${process.cwd()}/node_modules/`

type CaptureParser = (text: string) => readonly EditorSyntaxCapture[]

let parseTypeScript: CaptureParser
let parseMarkdown: CaptureParser

/**
 * Mirrors the worker's own collection: dedupe on start, end, name and language, then sort by span.
 * Two captures over one span with *different* names both survive that key, which is the whole
 * reason exact-span resolution has to happen afterwards.
 *
 * @see collectCapture and sortCaptures in packages/tree-sitter/src/treeSitter/treeSitter.worker.ts
 */
const collect = (
  query: Query,
  rootNode: Parameters<Query['matches']>[0],
  languageId: string,
  offset = 0,
): EditorSyntaxCapture[] => {
  const captures: EditorSyntaxCapture[] = []
  const seen = new Set<string>()

  for (const match of query.matches(rootNode)) {
    for (const capture of match.captures) {
      const node = capture.node
      if (!node) continue

      const startIndex = offset + node.startIndex
      const endIndex = offset + node.endIndex
      const captureName = capture.name ?? ''
      const key = `${startIndex}:${endIndex}:${captureName}:${languageId}`
      if (seen.has(key)) continue
      if (startIndex >= endIndex) continue

      seen.add(key)
      captures.push({ captureName, endIndex, startIndex })
    }
  }

  return captures.toSorted((a, b) => a.startIndex - b.startIndex || a.endIndex - b.endIndex)
}

beforeAll(async () => {
  await Parser.init()

  // What loadTypeScriptAssets ships for a non-tsx file: the TypeScript rules concatenated with the
  // JavaScript ones. Both files contribute a rule that matches a capitalised identifier.
  const typeScriptLanguage = await Language.load(
    await readFile(`${modulesDir}tree-sitter-typescript/tree-sitter-typescript.wasm`),
  )
  const typeScriptQuery = new Query(
    typeScriptLanguage,
    [
      await readFile(`${queriesDir}typescript-highlights.scm`, 'utf8'),
      await readFile(`${queriesDir}javascript-highlights.scm`, 'utf8'),
    ].join('\n'),
  )
  const typeScriptParser = new Parser()
  typeScriptParser.setLanguage(typeScriptLanguage)

  parseTypeScript = (text) => {
    const tree = typeScriptParser.parse(text)!
    const captures = collect(typeScriptQuery, tree.rootNode, 'typescript')
    tree.delete()
    return captures
  }

  await init()
  parseMarkdown = (text) => {
    const document = new MarkdownDocument()
    document.setText(text)
    const packed = document.highlights(0, text.length)
    const captures: EditorSyntaxCapture[] = []
    for (let index = 0; index < packed.length; index += 3) {
      captures.push({
        startIndex: packed[index]!,
        endIndex: packed[index + 1]!,
        captureName: CAPTURES[packed[index + 2]!]!,
      })
    }
    document.dispose()
    return captures
  }
})

const tokensOver = (tokens: readonly EditorToken[], start: number, end: number): EditorToken[] =>
  tokens.filter((token) => token.start === start && token.end === end)

const spanOf = (text: string, needle: string): readonly [number, number] => {
  const start = text.indexOf(needle)
  expect(start, `fixture must contain ${needle}`).toBeGreaterThanOrEqual(0)
  return [start, start + needle.length]
}

describe('exact-span capture overlaps', () => {
  // Four shipped rules match this identifier: @variable and @constant and @constructor from
  // javascript-highlights.scm, @type from typescript-highlights.scm. Before exact-span resolution
  // all four became tokens, each with its own style, all at the same highlight priority — and the
  // one that painted was decided by registry insertion order, i.e. by session history.
  const FIXTURE = 'const MAX = 10\n'

  it('emits one token for an identifier four rules claim, and it is the constant', () => {
    const tokens = treeSitterCapturesToEditorTokens(parseTypeScript(FIXTURE))
    const [start, end] = spanOf(FIXTURE, 'MAX')
    const over = tokensOver(tokens, start, end)

    expect(over).toHaveLength(1)
    expect(over[0]?.style).toEqual(styleForTreeSitterCapture('constant'))
    expect(over[0]?.style).not.toEqual(styleForTreeSitterCapture('type'))
    expect(over[0]?.style).not.toEqual(styleForTreeSitterCapture('constructor'))
    expect(over[0]?.style).not.toEqual(styleForTreeSitterCapture('variable'))
  })

  it('confirms the raw captures really do claim that span four times', () => {
    const [start, end] = spanOf(FIXTURE, 'MAX')
    const names = parseTypeScript(FIXTURE)
      .filter((capture) => capture.startIndex === start && capture.endIndex === end)
      .map((capture) => capture.captureName)
      .toSorted()

    expect(names).toEqual(['constant', 'constructor', 'type', 'variable'])
  })

  it('leaves no two tokens sharing a span across a broader fixture', () => {
    const source = [
      'const MAX = 10',
      'const Handler = class {}',
      'type Alias = string',
      'interface Shape { size: number }',
      'function build<T>(input: T): T { return input }',
      'namespace Outer { export const VALUE = 1 }',
      'const enumeration = { A: 1, B: 2 }',
      'class Widget extends Base { render() { return this.size } }',
      'export default Widget',
    ].join('\n')
    const tokens = treeSitterCapturesToEditorTokens(parseTypeScript(source))
    const spans = tokens.map((token) => `${token.start}:${token.end}`)

    expect(new Set(spans).size).toBe(spans.length)
  })

  it('produces byte-identical output for a document parsed either side of another one', () => {
    const other = 'class Other { method() { return NAME } }\nconst NAME = "x"\n'

    const first = treeSitterCapturesToEditorTokens(parseTypeScript(FIXTURE))
    treeSitterCapturesToEditorTokens(parseTypeScript(other))
    const second = treeSitterCapturesToEditorTokens(parseTypeScript(FIXTURE))

    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  /**
   * Siblings are not an overlap and must not be merged into one. `obj` and `prop` abut but claim
   * different characters, so both survive with their own colours — the resolver only ever chooses
   * where two captures want the same character.
   */
  it('keeps abutting captures as separate tokens', () => {
    const source = 'const value = obj.prop\n'
    const tokens = treeSitterCapturesToEditorTokens(parseTypeScript(source))
    const [start, end] = spanOf(source, 'obj.prop')
    const nested = tokens.filter((token) => token.start >= start && token.end <= end)

    expect(nested.length).toBeGreaterThan(1)
    expect(nested.some((token) => token.start !== start || token.end !== end)).toBe(true)
  })

  /**
   * A template literal is the shipped grammar's own nested overlap: `@string` covers the whole
   * literal and `@punctuation.special` covers each `${`/`}` inside it. The container is not dropped
   * for losing its middle — it comes back either side of the hole — and no character ends up
   * claimed by both.
   */
  it('splits a string around the interpolation markers nested in it', () => {
    const source = 'const greeting = `hello ${name} there`\n'
    const tokens = treeSitterCapturesToEditorTokens(parseTypeScript(source))
    const [start, end] = spanOf(source, '`hello ${name} there`')
    const inside = tokens.filter((token) => token.start >= start && token.end <= end)
    const stringStyle = styleForTreeSitterCapture('string')

    expect(
      inside.filter((token) => token.style.color === stringStyle?.color).length,
    ).toBeGreaterThan(1)
    expect(
      inside.filter(
        (token) => token.style.color === styleForTreeSitterCapture('punctuation.special')?.color,
      ).length,
    ).toBeGreaterThan(0)
    expect(
      inside.every((token, index) => index === 0 || token.start >= (inside[index - 1]?.end ?? 0)),
    ).toBe(true)
  })

  /**
   * `((identifier) @constructor (#match? "^[A-Z]"))` and `((identifier) @type (#match? "^[A-Z]"))`
   * are the same heuristic in two shipped query files, so neither knows more about the span than the
   * other. With `constructor` ranked as a declaration role it won every bare capitalised identifier
   * and painted it `syntax.typeDefinition`, while the same name in a `type_identifier` position —
   * which only `@type` claims — kept `syntax.type`. One class name, two different blues in one file.
   */
  it('paints a class name the same colour wherever it appears', () => {
    const source = 'class Widget {}\nconst w = new Widget()\nlet z: Widget\n'
    const tokens = treeSitterCapturesToEditorTokens(parseTypeScript(source))
    const colors = [...source.matchAll(/Widget/g)]
      .map((match) => match.index)
      .map(
        (start) =>
          tokens.find((token) => token.start <= start && token.end > start)?.style.color ?? null,
      )

    expect(colors).toHaveLength(3)
    expect(new Set(colors).size).toBe(1)
    expect(colors[0]).toBe(styleForTreeSitterCapture('type')?.color)
  })
})

describe('capture names deeper than the shipped queries produce', () => {
  /**
   * A grammar contributed through `registerLanguage` is free to name captures as deep as it likes,
   * and the style trie already resolves them by longest prefix — `keyword.declaration.function`
   * picks up `keyword.declaration`. The specificity table has to be read the same way, or the more
   * specific capture ranks below `variable` and loses its span to the one name the table calls the
   * fallback: the exact inversion the table exists to prevent.
   */
  it('ranks a three-segment name by its prefix rather than dropping it to the bottom', () => {
    const tokens = treeSitterCapturesToEditorTokens([
      { captureName: 'variable', endIndex: 3, startIndex: 0 },
      { captureName: 'keyword.declaration.function', endIndex: 3, startIndex: 0 },
    ])

    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.style).toEqual(styleForTreeSitterCapture('keyword.declaration'))
  })

  it('still puts an unranked name below every ranked one', () => {
    const tokens = treeSitterCapturesToEditorTokens([
      { captureName: 'variable', endIndex: 3, startIndex: 0 },
      { captureName: 'comment.doc.zig', endIndex: 3, startIndex: 0 },
    ])

    expect(tokens).toHaveLength(1)
    // `comment` is ranked, and above `variable`, so its deeper form wins the span.
    expect(tokens[0]?.style).toEqual(styleForTreeSitterCapture('comment'))
  })
})

describe('markdown emphasis and strong', () => {
  const FIXTURE = 'plain *emphasis* and **strong** text\n'

  // Both scopes used to declare a font property and nothing else. A ::highlight() rule cannot apply
  // one, so the rule was emitted, the group was registered, and the span painted exactly nothing.
  it('paints emphasis and strong with a colour of their own', () => {
    const tokens = treeSitterCapturesToEditorTokens(parseMarkdown(FIXTURE))
    const emphasis = tokens.find((token) => FIXTURE.slice(token.start, token.end) === '*emphasis*')
    const strong = tokens.find((token) => FIXTURE.slice(token.start, token.end) === '**strong**')

    expect(emphasis?.style.color).toBeTruthy()
    expect(strong?.style.color).toBeTruthy()
    expect(emphasis?.style.color).not.toBe(strong?.style.color)
  })

  // Plain markdown text carries no capture at all, so it paints in the editor's foreground. A
  // colour equal to another markdown scope's would be no more informative than the font property it
  // replaced. That these ids resolve to something other than the foreground is theme.test.ts's
  // question; that they are distinct from their neighbours is this one's.
  it('gives them a colour no other markdown scope shares', () => {
    const tokens = treeSitterCapturesToEditorTokens(parseMarkdown(FIXTURE))
    const [plainStart] = spanOf(FIXTURE, 'plain')
    const covering = tokens.filter((token) => token.start <= plainStart && token.end > plainStart)

    expect(covering).toHaveLength(0)

    // The three that can cover one character: a heading holds bold, and bold holds emphasis. Other
    // markdown scopes are free to share a hue — `text.literal` and `text.uri` do, and are told apart
    // by an underline — because they never contend for the same span.
    const colors = ['text.emphasis', 'text.strong', 'text.title'].map(
      (scope) => styleForTreeSitterCapture(scope)?.color,
    )
    expect(colors.every((color) => typeof color === 'string' && color.length > 0)).toBe(true)
    expect(new Set(colors).size).toBe(colors.length)
  })

  /**
   * The contest those colours would otherwise have created, and why exact-span resolution had to
   * widen to containment.
   *
   * A markdown heading is captured as `text.title` over the whole line, and a bold word inside it as
   * `text.strong` over part of it. Once both declare a `color` they are two `Highlight`s at the same
   * priority over the same characters, and the CSS Custom Highlight API resolves that by registry
   * insertion order — "which style key this session's shared registry saw first". Before the colours
   * landed the contest did not exist, because `text.strong` declared only `fontWeight`, which a
   * `::highlight()` rule cannot apply. So the fix for one defect created another, and only
   * per-character resolution closes both.
   */
  it('resolves a bold word inside a heading rather than leaving the two to contend', () => {
    const heading = '# A **B** C\n'
    const tokens = treeSitterCapturesToEditorTokens(parseMarkdown(heading))
    const [boldStart, boldEnd] = spanOf(heading, '**B**')
    const covering = tokens.filter((token) => token.start < boldEnd && token.end > boldStart)

    expect(covering).toHaveLength(1)
  })

  /**
   * The guarantee that makes registry order stop mattering at all: no two tokens claim a character.
   * Asserted over both grammars, because it is a property of the resolver rather than of a fixture.
   */
  it('emits tokens that never overlap', () => {
    for (const tokens of [
      treeSitterCapturesToEditorTokens(parseMarkdown(FIXTURE)),
      treeSitterCapturesToEditorTokens(parseMarkdown('# A **B** C\n\ntext with `code` in it\n')),
      treeSitterCapturesToEditorTokens(parseTypeScript('const x = `a ${b} c`\nconst MAX = 10\n')),
    ]) {
      expect(tokens.length).toBeGreaterThan(0)
      const overlapping = tokens.filter(
        (token, index) => index > 0 && token.start < (tokens[index - 1]?.end ?? 0),
      )
      expect(overlapping).toEqual([])
    }
  })
})
