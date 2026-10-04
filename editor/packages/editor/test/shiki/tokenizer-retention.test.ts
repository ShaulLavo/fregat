import { expect, it } from 'vitest'
import { createHighlighter } from 'shiki'
import {
  createIncrementalTokenizer,
  type IncrementalTokenizerRetentionSnapshot,
} from '../../src/shiki'

it('retention reads scalar storage counts through edits, reset and theme changes', async () => {
  const highlighter = await createHighlighter({
    langs: ['typescript'],
    themes: ['github-dark', 'github-light'],
  })
  try {
    const { tokenizer } = await createIncrementalTokenizer({
      highlighter,
      lang: 'typescript',
      theme: 'github-dark',
      maxLineLength: 20,
      code: 'const x = 1;\r\n// 🪐\n',
    })
    const check = () => {
      const before = tokenizer.getSnapshot()
      const tokens = tokenizer.getTokens()
      const result: IncrementalTokenizerRetentionSnapshot = tokenizer.inspectRetention()
      expect(result).toEqual({
        sourceUnits: before.code.length,
        lineCount: tokens.length,
        tokenCount: tokens.reduce((sum, line) => sum + line.length, 0),
      })
      expect(tokenizer.getSnapshot()).toEqual(before)
      expect(tokenizer.getTokens()).toEqual(tokens)
      expect(tokenizer.getTokens()[0]).not.toBe(tokens[0])
      return result
    }
    expect(check().lineCount).toBe(3)
    tokenizer.applyEdit({ from: 6, to: 7, text: 'answer' })
    check()
    tokenizer.applyEdits([
      { from: 0, to: 0, text: '// first\n' },
      { from: tokenizer.getCode().length, to: tokenizer.getCode().length, text: '// last' },
    ])
    check()
    tokenizer.update('x'.repeat(21))
    expect(check()).toEqual({ sourceUnits: 21, lineCount: 1, tokenCount: 1 })
    expect(tokenizer.untokenizedLineCount()).toBe(1)
    tokenizer.setTheme('github-light')
    check()
    tokenizer.reset()
    const empty = check()
    expect(empty.sourceUnits).toBe(0)
    expect(empty.lineCount).toBe(1)
  } finally {
    highlighter.dispose()
  }
})
