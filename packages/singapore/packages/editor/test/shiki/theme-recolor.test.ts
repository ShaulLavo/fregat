import { expect, it, vi } from 'vitest'
import { createHighlighter, type ThemedToken, type BundledTheme } from 'shiki'
import { createIncrementalTokenizer } from '../../src/shiki/tokenizer'
import { DEFAULT_SHIKI_MAX_TOKENIZATION_LINE_LENGTH } from '../../src/shiki/workerClient'

function paintedCharacters(lines: readonly (readonly ThemedToken[])[]) {
  return lines.map((line) =>
    line.flatMap((token) =>
      token.content
        .split('')
        .map((character) => [character, token.color?.toLowerCase(), token.fontStyle ?? 0]),
    ),
  )
}

it('recolors retained scopes exactly like Shiki without parsing again, then edits incrementally', async () => {
  const themes = ['github-dark', 'github-light', 'monokai', 'dracula', 'ayu-light'] as const
  const highlighter = await createHighlighter({
    themes: [...themes],
    langs: ['typescript', 'tsx', 'html', 'markdown'],
  })
  try {
    for (const lang of ['typescript', 'tsx', 'html', 'markdown'] as const) {
      await verifyLanguage(highlighter, lang, themes)
    }
  } finally {
    highlighter.dispose()
  }
})

async function verifyLanguage(
  highlighter: Awaited<ReturnType<typeof createHighlighter>>,
  lang: 'typescript' | 'tsx' | 'html' | 'markdown',
  themes: readonly BundledTheme[],
) {
  const code =
    '/* comment\n continued */\nconst value = `hello ${42}`;\n<div title="hello">text</div>\n# Heading\n**bold** and *italic*\n```ts\nconst n = 1\n```'
  const { tokenizer } = await createIncrementalTokenizer({
    highlighter,
    maxLineLength: DEFAULT_SHIKI_MAX_TOKENIZATION_LINE_LENGTH,
    lang,
    theme: themes[0]!,
    code,
  })
  const parse = vi.spyOn(highlighter.getLanguage(lang), 'tokenizeLine')
  const tokens = tokenizer.getTokens().flat()
  const first = tokens[0]!
  const second = tokens[1]!
  expect(Object.keys(first).sort()).toEqual(['color', 'content', 'fontStyle', 'offset'])
  expect(Object.getOwnPropertyDescriptor(first, 'color')?.get).toBe(
    Object.getOwnPropertyDescriptor(second, 'color')?.get,
  )
  for (const theme of themes) {
    parse.mockClear()
    tokenizer.setTheme(theme)
    expect(parse).not.toHaveBeenCalled()
    const expected = highlighter.codeToTokensBase(code, { lang, theme, tokenizeTimeLimit: 0 })
    expect(paintedCharacters(tokenizer.getTokens())).toEqual(paintedCharacters(expected))
    expect(JSON.parse(JSON.stringify(first))).toEqual({
      content: first.content,
      offset: first.offset,
      color: first.color,
      fontStyle: first.fontStyle,
    })
  }
  const edited = code.replace('42', 'value + 1')
  tokenizer.applyEdit({ from: code.indexOf('42'), to: code.indexOf('42') + 2, text: 'value + 1' })
  expect(paintedCharacters(tokenizer.getTokens())).toEqual(
    paintedCharacters(
      highlighter.codeToTokensBase(edited, { lang, theme: themes.at(-1)!, tokenizeTimeLimit: 0 }),
    ),
  )
  parse.mockRestore()
}
