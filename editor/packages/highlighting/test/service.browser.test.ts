import { afterEach, describe, expect, test } from 'vitest'

import {
  createHighlightingService,
  type HighlightTheme,
  type HighlightingService,
} from '../src/index'

function vscodeTheme(keyword: string, name = 'test-theme'): HighlightTheme {
  return {
    format: 'vscode',
    definition: {
      name,
      type: 'dark',
      colors: { 'editor.background': '#101010', 'editor.foreground': '#eeeeee' },
      tokenColors: [
        { scope: ['keyword', 'storage'], settings: { foreground: keyword } },
        { scope: ['comment'], settings: { foreground: '#777777', fontStyle: 'italic' } as never },
        { scope: ['string'], settings: { foreground: '#00aa00' } },
      ],
    },
  }
}

const services: HighlightingService[] = []
function service(): HighlightingService {
  const created = createHighlightingService()
  services.push(created)
  return created
}

afterEach(async () => {
  await Promise.all(services.splice(0).map((created) => created.dispose()))
})

function colorOf(
  result: { tokens: readonly { start: number; end: number; style: { color?: string } }[] },
  text: string,
  word: string,
) {
  const start = text.indexOf(word)
  return result.tokens.find((token) => token.start <= start && token.end > start)?.style
}

describe('standalone highlighting in the real worker', () => {
  test('multiline Unicode text keeps UTF-16 offsets, grammar state and font styles', async () => {
    const text = 'const s = "héllo 🎉"\n/* a\n   b */\nlet t = 1'
    const result = await service().highlight(text, {
      language: 'ts',
      theme: vscodeTheme('#ff0000'),
    })

    expect(result.language).toBe('typescript')
    expect(result.background.toLowerCase()).toBe('#101010')
    expect(result.foreground.toLowerCase()).toBe('#eeeeee')
    expect(colorOf(result, text, 'const')?.color?.toLowerCase()).toBe('#ff0000')
    expect(colorOf(result, text, 'let')?.color?.toLowerCase()).toBe('#ff0000')
    expect(colorOf(result, text, '🎉')?.color?.toLowerCase()).toBe('#00aa00')
    // The comment spans lines: its second line is colored only if state carried over.
    expect(colorOf(result, text, 'b */')).toMatchObject({ fontStyle: 'italic' })
    for (const token of result.tokens) {
      expect(token.end).toBeGreaterThan(token.start)
      expect(token.end).toBeLessThanOrEqual(text.length)
    }
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.tokens[0]?.style)).toBe(true)
  })

  test('empty text and unknown languages answer plain text with the theme colors', async () => {
    const highlighting = service()
    const empty = await highlighting.highlight('', {
      language: 'ts',
      theme: vscodeTheme('#ff0000'),
    })
    expect(empty.tokens).toEqual([])
    expect(empty.background.toLowerCase()).toBe('#101010')

    const unknown = await highlighting.highlight('const x', {
      language: 'no-such-language',
      theme: vscodeTheme('#ff0000'),
    })
    expect(unknown.language).toBe('text')
    expect(unknown.tokens).toEqual([])
  })

  test('same-name themes with different content never share colors, even concurrently', async () => {
    const highlighting = service()
    const red = vscodeTheme('#ff0000', 'mine')
    const blue = vscodeTheme('#0000ff', 'mine')
    const [first, second] = await Promise.all([
      highlighting.highlight('const a = 1', { language: 'typescript', theme: red }),
      highlighting.highlight('const a = 1', { language: 'typescript', theme: blue }),
    ])
    expect(first.themeRevision).not.toBe(second.themeRevision)
    expect(first.tokens[0]?.style.color?.toLowerCase()).toBe('#ff0000')
    expect(second.tokens[0]?.style.color?.toLowerCase()).toBe('#0000ff')
  })

  test('an Editor palette highlights without any imported theme', async () => {
    const result = await service().highlight('const a = 1', {
      language: 'typescript',
      theme: {
        format: 'editor',
        definition: { backgroundColor: '#202020', syntax: { keywordDeclaration: '#abcdef' } },
      },
    })
    expect(result.background.toLowerCase()).toBe('#202020')
    expect(result.tokens.length).toBeGreaterThan(0)
  })

  test('abort rejects the caller, publishes nothing, and leaves the shared worker serving', async () => {
    const highlighting = service()
    const controller = new AbortController()
    const large = 'const value = [1, 2, 3].map((item) => item * 2)\n'.repeat(4_000)
    const aborted = highlighting.highlight(large, {
      language: 'typescript',
      theme: vscodeTheme('#ff0000'),
      signal: controller.signal,
    })
    controller.abort()
    await expect(aborted).rejects.toMatchObject({ code: 'aborted' })

    const next = await highlighting.highlight('let b', {
      language: 'typescript',
      theme: vscodeTheme('#ff0000'),
    })
    expect(next.tokens[0]?.style.color?.toLowerCase()).toBe('#ff0000')
    await highlighting.awaitIdle()
    expect(highlighting.inspect()).toMatchObject({
      pendingHighlights: 0,
      shiki: { pendingRequests: 0 },
    })
  })

  test('disposal settles requests in flight and stops the worker', async () => {
    const highlighting = service()
    const pending = highlighting.highlight('const a = 1', {
      language: 'typescript',
      theme: vscodeTheme('#ff0000'),
    })
    await highlighting.dispose()
    await expect(pending).rejects.toBeInstanceOf(Error)
    expect(highlighting.inspect().shiki).toBeNull()
  })
})
