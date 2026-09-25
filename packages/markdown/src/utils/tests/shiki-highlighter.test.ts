import { createHighlighterCore, type TokensResult } from 'shiki/core'
import { expect, test, vi } from 'vitest'
import { createShikiHighlighter, type ShikiHighlighterOptions } from '../shiki-highlighter'
import type { CodeHighlighter } from '../../providers/code-highlighter-context'

const input = { code: 'const value = 1', language: 'typescript' }
function palette(foreground: string): ShikiHighlighterOptions['themes'] {
  return [
    { name: 'day', settings: [{ settings: { foreground } }] },
    { name: 'night', settings: [{ settings: { foreground } }] },
  ]
}

function highlight(highlighter: CodeHighlighter) {
  return new Promise<TokensResult>((resolve) => {
    const immediate = highlighter.highlight(input, resolve)
    if (immediate) resolve(immediate)
  })
}

test('the same language retries after initialization failure', async () => {
  const createCore = vi
    .fn(createHighlighterCore)
    .mockRejectedValueOnce(new Error('fixture init failure'))
  const highlighter = createShikiHighlighter({
    themes: palette('#123456'),
    themeKey: 'retry',
    createCore,
  })
  try {
    const first = vi.fn()
    expect(highlighter.highlight(input, first)).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(first).not.toHaveBeenCalled()
    const result = highlight(highlighter)
    expect(createCore).toHaveBeenCalledTimes(2)
    expect(
      (await result).tokens
        .flat()
        .map((token) => token.content)
        .join(''),
    ).toBe(input.code)
    expect(highlighter.highlight({ ...input, language: 'ts' }, first)).not.toBeNull()
    expect(first).not.toHaveBeenCalled()
  } finally {
    highlighter.dispose()
  }
})

test('concurrent grammar requests share one initialization and registration', async () => {
  const registrations: string[] = []
  const createCore = vi.fn(async (...args: Parameters<typeof createHighlighterCore>) => {
    const core = await createHighlighterCore(...args)
    const original = core.loadLanguage
    vi.spyOn(core, 'loadLanguage').mockImplementation(async (...languages) => {
      registrations.push('language')
      await original(...languages)
    })
    return core
  })
  const highlighter = createShikiHighlighter({
    themes: palette('#123456'),
    themeKey: 'shared',
    createCore,
  })
  try {
    const [first, second] = await Promise.all([highlight(highlighter), highlight(highlighter)])
    expect(first.tokens).toEqual(second.tokens)
    expect(createCore).toHaveBeenCalledTimes(1)
    expect(registrations).toHaveLength(1)
  } finally {
    highlighter.dispose()
  }
})

test('separate palettes never share a mutable core, even with equal theme names', async () => {
  const first = createShikiHighlighter({ themes: palette('#123456'), themeKey: 'first' })
  const second = createShikiHighlighter({ themes: palette('#abcdef'), themeKey: 'second' })
  try {
    const [one, two] = await Promise.all([highlight(first), highlight(second)])
    expect(one.tokens[0]?.[0]?.htmlStyle?.['--shiki-dark']).toBe('#123456')
    expect(two.tokens[0]?.[0]?.htmlStyle?.['--shiki-dark']).toBe('#ABCDEF')
  } finally {
    first.dispose()
    second.dispose()
  }
})

test('disposal releases an initialization that completes late and suppresses its callback', async () => {
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const cores: Awaited<ReturnType<typeof createHighlighterCore>>[] = []
  const createCore = async (...args: Parameters<typeof createHighlighterCore>) => {
    await gate
    const core = await createHighlighterCore(...args)
    vi.spyOn(core, 'dispose')
    cores.push(core)
    return core
  }
  const highlighter = createShikiHighlighter({
    themes: palette('#123456'),
    themeKey: 'disposed',
    createCore,
  })
  const accept = vi.fn()
  highlighter.highlight(input, accept)
  highlighter.dispose()
  highlighter.dispose()
  release()
  await vi.waitFor(() => expect(cores[0]?.dispose).toHaveBeenCalledTimes(1))
  expect(accept).not.toHaveBeenCalled()
  expect(highlighter.highlight(input, accept)).toBeNull()
})

test('disposal releases the loaded core once and prevents reacquisition', async () => {
  const cores: Awaited<ReturnType<typeof createHighlighterCore>>[] = []
  const createCore = vi.fn(async (...args: Parameters<typeof createHighlighterCore>) => {
    const core = await createHighlighterCore(...args)
    vi.spyOn(core, 'dispose')
    cores.push(core)
    return core
  })
  const highlighter = createShikiHighlighter({
    themes: palette('#123456'),
    themeKey: 'closed',
    createCore,
  })
  await highlight(highlighter)
  highlighter.dispose()
  highlighter.dispose()
  expect(cores[0]?.dispose).toHaveBeenCalledTimes(1)
  expect(highlighter.highlight(input, vi.fn())).toBeNull()
  expect(createCore).toHaveBeenCalledTimes(1)
})

test('a failed grammar publishes plain tokens and stays plain for later chunks', async () => {
  const loadGrammar = vi.fn(async () => {
    throw new Error('fixture grammar failure')
  })
  const highlighter = createShikiHighlighter({
    themes: palette('#123456'),
    themeKey: 'failed-grammar',
    createCore: async (...args) => {
      const core = await createHighlighterCore(...args)
      vi.spyOn(core, 'loadLanguage').mockImplementation(loadGrammar)
      return core
    },
  })
  const accept = vi.fn()
  try {
    expect(highlighter.highlight(input, accept)).toBeNull()
    await vi.waitFor(() => expect(accept).toHaveBeenCalledTimes(1))
    const appended = { ...input, code: `${input.code};\nconst next = 2` }
    const result = highlighter.highlight(appended, accept)
    expect(
      result?.tokens
        .flat()
        .map((token) => token.content)
        .join('\n'),
    ).toBe(appended.code)
    expect(loadGrammar).toHaveBeenCalledTimes(1)
  } finally {
    highlighter.dispose()
  }
})
