import { describe, expect, it } from 'vitest'
import {
  decodeDocumentPaint,
  decodeSnapshot,
  DOCUMENT_PAINT_LIMITS,
  safePaintLink,
  type SavedDocumentPaint,
} from '../src/editor/documentPaint'

const style = {
  color: 'rgb(20, 30, 40)',
  backgroundColor: 'rgba(0, 0, 0, 0)',
  fontWeight: '400',
  fontStyle: 'normal',
  textDecoration: 'none',
  fontFamily: 'monospace',
  fontSize: '14px',
  visibility: 'visible',
  letterSpacing: 'normal',
  fontFeatureSettings: 'normal',
  fontVariationSettings: 'normal',
  fontKerning: 'auto',
  fontVariantLigatures: 'normal',
} as const

function fixture(count = 1): SavedDocumentPaint {
  return {
    format: 6,
    scope: 'document',
    appearance: '{}',
    style,
    gutterBackgroundColor: 'transparent',
    gutterWidth: 32,
    characterWidth: 8,
    monospace: true,
    rowGap: 0,
    tabSize: 4,
    wrap: 'word',
    rows: Array.from({ length: count }, () => ({
      height: 20,
      style,
      heading: null,
      gutterBackgroundColor: 'transparent',
      gutterInsetBackgroundColor: 'transparent',
      gutter: [],
      runs: [{ text: 'alpha beta gamma', style, href: null }],
    })),
  }
}

it('admits a complete document above the viewport row limit', () => {
  const paint = fixture(401)
  expect(decodeDocumentPaint(JSON.stringify(paint))).toEqual(paint)
})

it.each(['{', 'null', '[]', '{"format":5}', '{"format":7}'])(
  'refuses malformed paint %s',
  (paint) => {
    expect(decodeSnapshot(paint)).toBeNull()
  },
)

it('bounds UTF-8 bytes before parsing and keeps viewport payload bounds intact', () => {
  expect(decodeSnapshot(' '.repeat(DOCUMENT_PAINT_LIMITS.bytes + 1))).toBeNull()
  const paint = fixture()
  const huge = { ...paint, appearance: '😀'.repeat(600_000) }
  expect(decodeSnapshot(JSON.stringify(huge))).toBeNull()
  expect(decodeSnapshot(JSON.stringify({ ...paint, format: 5 }))).toBeNull()
})

it('bounds total runs, text, rows, height and gutter width', () => {
  expect(decodeSnapshot(JSON.stringify(fixture(DOCUMENT_PAINT_LIMITS.rows + 1)))).toBeNull()
  const paint = fixture()
  for (const replacement of [
    { characterWidth: 0 },
    { monospace: undefined },
    { monospace: 1 },
    { rowGap: -1 },
    { tabSize: 0 },
    { tabSize: 2.5 },
    { wrap: 'native' },
    { scope: 'viewport' },
    { rows: [{ ...paint.rows[0], height: 0 }] },
    { rows: [{ ...paint.rows[0], height: 1025 }] },
    {
      rows: [
        {
          ...paint.rows[0],
          gutter: [
            {
              text: '1',
              width: 100,
              color: '#000',
              backgroundColor: 'transparent',
              paddingRight: 0,
            },
          ],
        },
      ],
    },
  ])
    expect(decodeSnapshot(JSON.stringify({ ...paint, ...replacement }))).toBeNull()
})

describe('link targets', () => {
  it.each([
    'https://example.com/a',
    'http://example.com',
    'mailto:reader@example.com',
    '#heading',
    '/docs/a',
    './a',
    '../a',
    'playground.mdx',
    'unknown',
  ])('admits %s', (href) => expect(safePaintLink(href)).toBe(true))
  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,test',
    'file:///tmp/a',
    '//evil.example/a',
    '/\\evil.example',
    ' https://example.com',
    'https:\n//example.com',
    'https://reader:secret@example.com',
    '#',
  ])('refuses %s', (href) => {
    expect(safePaintLink(href)).toBe(false)
    const paint = fixture()
    expect(
      decodeSnapshot(
        JSON.stringify({
          ...paint,
          rows: [{ ...paint.rows[0], runs: [{ text: 'link', style, href }] }],
        }),
      ),
    ).toBeNull()
  })
})

it('refuses unsafe style values and malformed heading facts', () => {
  const paint = fixture()
  for (const replacement of [
    { color: 'url(https://example.com)' },
    { color: 'var(--editor-syntax-keyword)' },
    { backgroundColor: 'var(--editor-background)' },
    { backgroundColor: 'expression(alert(1))' },
    { fontSize: '1000000px' },
    { fontFamily: 'url(example.com)' },
    { visibility: 'collapse' },
    { textDecoration: 'underline; background: red' },
    { fontWeight: '100000' },
    { fontKerning: 'normal; color: red' },
    { fontKerning: ['none'] },
    { fontVariantLigatures: 'url(example.com)' },
  ])
    expect(
      decodeSnapshot(JSON.stringify({ ...paint, style: { ...style, ...replacement } })),
    ).toBeNull()
  for (const heading of [
    { level: 7, name: 'a', id: 'a' },
    { level: 1.5, name: 'a', id: 'a' },
    { level: 1, name: 'a', id: 'a b' },
  ])
    expect(
      decodeSnapshot(JSON.stringify({ ...paint, rows: [{ ...paint.rows[0], heading }] })),
    ).toBeNull()
  expect(
    decodeSnapshot(
      JSON.stringify({
        ...paint,
        rows: Array.from({ length: 2 }, () => ({
          ...paint.rows[0],
          heading: { level: 1, name: 'a', id: 'same' },
        })),
      }),
    ),
  ).toBeNull()
})

it('refuses unsafe row, inset and cell gutter backgrounds', () => {
  const paint = fixture()
  const row = paint.rows[0]!
  for (const changed of [
    { ...row, gutterBackgroundColor: 'url(https://example.com)' },
    { ...row, gutterInsetBackgroundColor: 'url(https://example.com)' },
    {
      ...row,
      gutter: [
        {
          text: '1',
          width: 32,
          color: '#000',
          backgroundColor: 'url(https://example.com)',
          paddingRight: 0,
        },
      ],
    },
  ])
    expect(decodeSnapshot(JSON.stringify({ ...paint, rows: [changed] }))).toBeNull()
})
