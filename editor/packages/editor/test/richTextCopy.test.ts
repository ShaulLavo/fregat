import { describe, expect, it } from 'vitest'

import { readRichTextFont, richTextForCopy, type RichTextFont } from '../src/editor/richText'
import { EditorTokenStore } from '../src/syntax/tokenStore'
import type { EditorToken } from '../src/tokens'

// What a copy hands to something that is not a text editor. Everything here is about what the
// markup is allowed to say: which characters survive into it, and which of them never reach it.

const FONT: RichTextFont = {
  family: 'ui-monospace, monospace',
  lineHeight: '20px',
  size: '13px',
  weight: '400',
}

const copy = (
  text: string,
  tokens: readonly EditorToken[],
  overrides: Partial<Parameters<typeof richTextForCopy>[0]> & { startOffset?: number } = {},
): string | null =>
  richTextForCopy({
    font: FONT,
    fragments: [{ startOffset: overrides.startOffset ?? 0, text, separator: '' }],
    theme: { backgroundColor: '#1e1e1e', foregroundColor: '#d4d4d4' },
    tokens: EditorTokenStore.fromTokens(tokens),
    ...overrides,
  })

const token = (start: number, end: number, color: string): EditorToken => ({
  end,
  start,
  style: { color },
})

describe('rich text for copy', () => {
  it('carries each token as a span holding the colour it was read in', () => {
    const html = copy('const x', [token(0, 5, '#569cd6')])

    expect(html).toContain('<span style="color: #569cd6;">const</span>')
    expect(html).toContain(' x')
    expect(html).toContain('background-color: #1e1e1e;')
  })

  it('keeps runs of spaces, which every target it is pasted into would otherwise collapse', () => {
    const html = copy('    x', [token(4, 5, '#9cdcfe')])

    expect(html).toContain('white-space: pre;')
  })

  // A document nothing has highlighted would render exactly as the plain text beside it does, and
  // the target prefers the larger payload.
  it('declines a range no token has anything to say about', () => {
    expect(copy('plain text', [])).toBeNull()
    expect(copy('plain text', [token(0, 5, '')])).toBeNull()
  })

  it('declines a payload past the size cap rather than building markup several times its length', () => {
    const text = 'x'.repeat(65536)
    expect(copy(text, [token(0, 10, '#569cd6')])).not.toBeNull()
    expect(copy(`${text}x`, [token(0, 10, '#569cd6')])).toBeNull()
  })

  it('escapes text that would otherwise be read as markup of its own', () => {
    const html = copy('a<b && c>d', [token(0, 10, '#569cd6')])

    expect(html).toContain('a&lt;b &amp;&amp; c&gt;d')
    expect(html).not.toContain('<b ')
  })

  it('measures token offsets against the document, not against the copied fragment', () => {
    const html = copy('const', [token(10, 15, '#569cd6')], { startOffset: 10 })

    expect(html).toContain('<span style="color: #569cd6;">const</span>')
  })

  // Two providers can both have something to say about one character; the second one to arrive
  // must not get it emitted a second time.
  it('gives a character overlapping tokens both claim to the first of them', () => {
    const html = copy('abcd', [token(0, 3, '#111111'), token(2, 4, '#222222')])

    expect(html).toBe(
      `<div style="${styleOf(html)}"><span style="color: #111111;">abc</span>` +
        '<span style="color: #222222;">d</span></div>',
    )
  })

  it('drops a font family that could close the attribute it is written into', () => {
    const html = copy('const', [token(0, 5, '#569cd6')], {
      font: { ...FONT, family: 'Fira Code"><script>' },
    })

    expect(html).toContain('font-family: monospace;')
    expect(html).not.toContain('script')
  })

  it('quotes a single family whose name has a space in it, and names the generic behind it', () => {
    const html = copy('const', [token(0, 5, '#569cd6')], {
      font: { ...FONT, family: 'Fira Code' },
    })

    expect(html).toContain("font-family: 'Fira Code', monospace;")
  })

  it('drops a style value carrying a declaration of its own', () => {
    const html = copy('const', [{ end: 5, start: 0, style: { color: 'red; position: fixed' } }])

    expect(html).toBeNull()
  })

  it('reads the typography off the element the document is displayed in', () => {
    const element = document.createElement('div')
    element.style.fontFamily = 'Menlo'
    element.style.fontSize = '11px'
    document.body.appendChild(element)

    expect(readRichTextFont(element).family).toBe('Menlo')
    expect(readRichTextFont(element).size).toBe('11px')

    element.remove()
  })
})

/** The root declarations of a rendered payload, so a body assertion need not restate them. */
function styleOf(html: string | null): string {
  return /<div style="([^"]*)"/.exec(html ?? '')?.[1] ?? ''
}

it('bounds total source length across fragments', () => {
  const fragments = [
    { startOffset: 0, text: 'x'.repeat(40000), separator: '\n' },
    { startOffset: 0, text: 'x'.repeat(40000), separator: '' },
  ]
  expect(copy('', [token(0, 1, 'red')], { fragments })).toBeNull()
})

it('bounds UTF-8 output bytes independently of source length across fragments', () => {
  const tokens = Array.from({ length: 30000 }, (_, offset) => token(offset, offset + 1, 'red'))
  const fragmentsFor = (character: string) => [
    { startOffset: 0, text: character.repeat(15000), separator: '\n' },
    { startOffset: 15000, text: character.repeat(15000), separator: '' },
  ]
  const ascii = copy('', tokens, { fragments: fragmentsFor('x') })
  expect(ascii).not.toBeNull()
  expect(new TextEncoder().encode(ascii!).byteLength).toBeLessThanOrEqual(1024 * 1024)
  expect(copy('', tokens, { fragments: fragmentsFor('界') })).toBeNull()
})

it('keeps fragment order, separators, escaping and unhighlighted portions', () => {
  const fragments = [
    { startOffset: 10, text: '<b>', separator: '\n' },
    { startOffset: 30, text: '&plain', separator: '' },
  ]
  const html = copy('', [token(10, 13, 'red')], { fragments })
  expect(html).toContain('<span style="color: red;">&lt;b&gt;</span>\n&amp;plain')
  expect(html?.match(/<div/g)).toHaveLength(1)
})

it('bounds token visits across disjoint fragments with overlapping syntax tokens', () => {
  const fragments = Array.from({ length: 1000 }, (_, i) => ({
    startOffset: i * 2,
    text: 'x',
    separator: '\n',
  }))
  const tokens = [
    token(0, 2000, 'red'),
    ...fragments.map((fragment) => token(fragment.startOffset, fragment.startOffset + 1, 'blue')),
  ]
  expect(copy('', tokens, { fragments })).toBeNull()
})

it('keeps many fragments styled just below the cumulative token-visit limit', () => {
  const fragments = Array.from({ length: 361 }, (_, i) => ({
    startOffset: i * 2,
    text: 'x',
    separator: '\n',
  }))
  const tokens = [
    token(0, 722, 'red'),
    ...fragments.map((fragment) => token(fragment.startOffset, fragment.startOffset + 1, 'blue')),
  ]
  const html = copy('', tokens, { fragments: fragments.slice(0, 360) })
  expect(html).toContain('<span style="color: blue;">x</span>\n')
  expect(html?.match(/<span style="color: red;">x<\/span>\n/g)).toHaveLength(359)
  expect(copy('', tokens, { fragments })).toBeNull()
})
