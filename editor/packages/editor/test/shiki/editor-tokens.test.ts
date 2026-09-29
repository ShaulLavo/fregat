import { afterEach, describe, expect, it } from 'vitest'
import { createHighlighter } from 'shiki'

import {
  createIncrementalTokenizer,
  snapshotToEditorTokens,
  tokenLinesToEditorTokens,
} from '../../src/shiki'
import { snapshotToPackedEditorTokens } from '../../src/shiki/editor-tokens'
import { unpackEditorTokens } from '../../src/syntax/packedTokens'
import { EditorTokenStore } from '../../src/syntax/tokenStore'

describe('editor token adapters', () => {
  it('converts line-local token offsets into document offsets', () => {
    const tokens = tokenLinesToEditorTokens([
      {
        text: 'const answer = 42',
        tokens: [
          { color: '#f00', content: 'const', fontStyle: 0, offset: 0 },
          { color: '#0f0', content: 'answer', fontStyle: 0, offset: 6 },
        ],
      },
      {
        text: 'return answer',
        tokens: [{ color: '#00f', content: 'return', fontStyle: 0, offset: 0 }],
      },
    ])

    expect(tokens).toEqual([
      { end: 5, start: 0, style: { color: '#f00' } },
      { end: 12, start: 6, style: { color: '#0f0' } },
      { end: 24, start: 18, style: { color: '#00f' } },
    ])
    expect(EditorTokenStore.fromTokens(tokens)).toMatchObject({
      monotonicEnd: true,
      nonOverlapping: true,
    })
  })

  it('maps Shiki font styles into editor styles', () => {
    const tokens = snapshotToEditorTokens({
      lines: [
        {
          text: 'value',
          tokens: [
            {
              color: '#fff',
              content: 'value',
              fontStyle: 1 | 2 | 4 | 8,
              offset: 0,
            },
          ],
        },
      ],
    })

    expect(tokens).toEqual([
      {
        end: 5,
        start: 0,
        style: {
          color: '#fff',
          fontStyle: 'italic',
          fontWeight: 700,
          textDecoration: 'underline line-through',
        },
      },
    ])
  })

  it('interns equal Shiki styles instead of retaining one style object per token', () => {
    const tokens = tokenLinesToEditorTokens([
      {
        text: 'left right',
        tokens: [
          { color: '#f00', content: 'left', fontStyle: 0, offset: 0 },
          { color: '#f00', content: 'right', fontStyle: 0, offset: 5 },
        ],
      },
    ])

    expect(tokens[0]?.style).toBe(tokens[1]?.style)
  })

  it('packs snapshots directly with a value-interned palette and indexed token metadata', () => {
    const packed = snapshotToPackedEditorTokens({
      lines: [
        {
          text: 'red blue',
          tokens: [
            { color: '#f00', content: 'red', fontStyle: 0, offset: 0 },
            { color: '#f00', content: 'blue', fontStyle: 0, offset: 4 },
          ],
        },
        {
          text: 'green',
          tokens: [
            {
              bgColor: '#020',
              color: '#0f0',
              content: 'green',
              fontStyle: 1 | 4,
              offset: 0,
            },
          ],
        },
      ],
    })

    expect(Array.from(packed.starts)).toEqual([0, 4, 9])
    expect(Array.from(packed.ends)).toEqual([3, 8, 14])
    expect(Array.from(packed.styleIds)).toEqual([0, 0, 1])
    expect(packed.styles).toEqual([
      { color: '#f00' },
      {
        backgroundColor: '#020',
        color: '#0f0',
        fontStyle: 'italic',
        textDecoration: 'underline',
      },
    ])
    expect(packed).toMatchObject({
      monotonicEnd: true,
      nonOverlapping: true,
      sortedByStart: true,
    })

    const unpacked = unpackEditorTokens(packed)
    expect(unpacked).toEqual([
      { end: 3, start: 0, style: { color: '#f00' } },
      { end: 8, start: 4, style: { color: '#f00' } },
      {
        end: 14,
        start: 9,
        style: {
          backgroundColor: '#020',
          color: '#0f0',
          fontStyle: 'italic',
          textDecoration: 'underline',
        },
      },
    ])
    expect(unpacked[0]?.style).toBe(unpacked[1]?.style)
    const store = EditorTokenStore.fromPacked(packed)
    expect(store.toTokens()).toEqual(unpacked)
    expect(store).toMatchObject({ monotonicEnd: true, nonOverlapping: true })
  })
})

describe('shiki-to-editor integration', () => {
  const highlighters: Array<{ dispose: () => void }> = []

  afterEach(() => {
    while (highlighters.length > 0) highlighters.pop()?.dispose()
  })

  it('tokenizes code through Shiki and produces valid EditorToken offsets', async () => {
    const code = 'const x = 1;\nconst y = 2;'
    const highlighter = await createHighlighter({
      langs: ['typescript'],
      themes: ['github-dark'],
    })
    const { tokenizer } = await createIncrementalTokenizer({
      lang: 'typescript',
      theme: 'github-dark',
      code,
      highlighter,
    })
    highlighters.push(highlighter)

    const tokens = snapshotToEditorTokens(tokenizer.getSnapshot())

    expect(tokens.length).toBeGreaterThan(0)
    for (const token of tokens) {
      expect(token.start).toBeGreaterThanOrEqual(0)
      expect(token.end).toBeLessThanOrEqual(code.length)
      expect(token.end).toBeGreaterThan(token.start)
      expect(token.style).toBeDefined()
      expect(Object.keys(token.style).length).toBeGreaterThan(0)
    }
  })
})
