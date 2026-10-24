import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHighlighter, type Highlighter } from 'shiki'

import { createIncrementalTokenizer } from '../../src/shiki'

const limit = 20
let highlighter: Highlighter | null = null

async function tokenizerFor(code: string, maxLineLength = limit) {
  highlighter ??= await createHighlighter({
    themes: ['github-dark', 'github-light'],
    langs: ['typescript'],
  })
  const { tokenizer } = await createIncrementalTokenizer({
    lang: 'typescript',
    theme: 'github-dark',
    code,
    highlighter,
    maxLineLength,
  })
  return tokenizer
}

afterEach(() => {
  highlighter?.dispose()
  highlighter = null
})

describe('Shiki tokenization line limit', () => {
  it('tokenizes a line at the limit and leaves a longer line as one plain token', async () => {
    const atLimit = 'const a = 1 + 234567' // 20 units
    const overLimit = `${atLimit};`
    const tokenizer = await tokenizerFor(`${atLimit}\n${overLimit}`)
    const [first, second] = tokenizer.getTokens()

    expect(atLimit).toHaveLength(limit)
    expect(first!.length).toBeGreaterThan(1)
    expect(second).toHaveLength(1)
    expect(second![0]!.content).toBe(overLimit)
    expect(second![0]!.color?.toLowerCase()).toBe(
      highlighter!.getTheme('github-dark').fg.toLowerCase(),
    )
    expect(tokenizer.untokenizedLineCount()).toBe(1)
  })

  it('carries the grammar state across a plain line to the next line', async () => {
    const plain = 'x'.repeat(limit + 1)
    const skipped = await tokenizerFor(`/* open\n${plain}\nstill */ const b = 2`)
    const reference = await tokenizerFor(`/* open\nshort\nstill */ const b = 2`)

    const colors = (tokens: readonly { content: string; color?: string }[]) =>
      tokens.map((token) => [token.content, token.color])
    expect(colors(skipped.getTokens()[2]!)).toEqual(colors(reference.getTokens()[2]!))
    expect(skipped.getTokens()[2]![0]!.content.startsWith('still')).toBe(true)
  })

  it('counts plain lines of the current text through edits and their reversal', async () => {
    const tokenizer = await tokenizerFor('const a = 1\nconst b = 2')
    expect(tokenizer.untokenizedLineCount()).toBe(0)

    const growth = ' + 1'.repeat(10)
    tokenizer.applyEdit({ from: 11, to: 11, text: growth })
    expect(tokenizer.untokenizedLineCount()).toBe(1)
    expect(tokenizer.getTokens()[0]).toHaveLength(1)

    tokenizer.applyEdit({ from: 11, to: 11 + growth.length, text: '' })
    expect(tokenizer.untokenizedLineCount()).toBe(0)
    expect(tokenizer.getCode()).toBe('const a = 1\nconst b = 2')

    tokenizer.update('x'.repeat(limit + 1))
    expect(tokenizer.untokenizedLineCount()).toBe(1)
    tokenizer.reset('short')
    expect(tokenizer.untokenizedLineCount()).toBe(0)
  })

  it('recolors a plain line to the new theme foreground without reparsing it', async () => {
    const plain = 'y'.repeat(limit + 5)
    const tokenizer = await tokenizerFor(plain)
    const tokenize = vi.spyOn(highlighter!.getLanguage('typescript'), 'tokenizeLine')

    tokenizer.setTheme('github-light')

    expect(tokenize).not.toHaveBeenCalled()
    expect(tokenizer.untokenizedLineCount()).toBe(1)
    expect(tokenizer.getTokens()[0]![0]!.color?.toLowerCase()).toBe(
      highlighter!.getTheme('github-light').fg.toLowerCase(),
    )
  })
})
