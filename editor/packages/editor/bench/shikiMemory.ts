import { createHighlighter } from 'shiki'
import { createIncrementalTokenizer } from '../src/shiki/tokenizer'
import { DEFAULT_SHIKI_MAX_TOKENIZATION_LINE_LENGTH } from '../src/shiki/workerClient'

let retained: Awaited<ReturnType<typeof createIncrementalTokenizer>> | null = null
const line = 'function value() {\n  return 123\n}\n'

const run = async (size: number) => {
  const code = line.repeat(Math.floor(size / line.length))
  const highlighter = await createHighlighter({
    themes: ['github-dark', 'github-light'],
    langs: ['typescript'],
  })
  const start = performance.now()
  retained = await createIncrementalTokenizer({
    highlighter,
    lang: 'typescript',
    theme: 'github-dark',
    maxLineLength: DEFAULT_SHIKI_MAX_TOKENIZATION_LINE_LENGTH,
    code,
  })
  const tokenizeMs = performance.now() - start
  const tokens = retained.tokenizer.getTokens()
  const count = tokens.reduce((sum, line) => sum + line.length, 0)
  const firstColor = tokens[0]?.[0]?.color
  retained.tokenizer.setTheme('github-light')
  const changedColor = tokens[0]?.[0]?.color
  return {
    units: code.length,
    lines: tokens.length,
    tokens: count,
    tokenizeMs,
    firstColor,
    changedColor,
  }
}
const dispose = () => {
  retained?.highlighter.dispose()
  retained = null
}
declare global {
  var __shikiMemory: { run: typeof run; dispose: typeof dispose }
}
globalThis.__shikiMemory = { run, dispose }
