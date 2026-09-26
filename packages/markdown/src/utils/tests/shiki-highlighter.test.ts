import { afterEach, expect, test, vi } from 'vitest'

import { createShikiHighlighter } from '../shiki-highlighter'

const engine = vi.hoisted(() => ({ failures: 0 }))

vi.mock('shiki/engine/javascript', async (importOriginal) => {
  const actual = await importOriginal<typeof import('shiki/engine/javascript')>()
  return {
    ...actual,
    createJavaScriptRegexEngine: (
      ...args: Parameters<typeof actual.createJavaScriptRegexEngine>
    ) => {
      if (engine.failures > 0) {
        engine.failures -= 1
        throw new TypeError('chunk failed to load')
      }
      return actual.createJavaScriptRegexEngine(...args)
    },
  }
})

afterEach(() => {
  engine.failures = 0
})

const theme = { name: 'plain', type: 'light' as const, settings: [], colors: {} }

function highlightOnce(highlighter: ReturnType<typeof createShikiHighlighter>) {
  // Promise.withResolvers is missing on Node 20, which runs the package tests.
  return new Promise<unknown>((resolve) => {
    const immediate = highlighter.highlight({ code: 'const a = 1', language: 'ts' }, resolve)
    if (immediate) resolve(immediate)
  })
}

test('a core that fails to load is retried by the next fence of the same language', async () => {
  engine.failures = 1
  const highlighter = createShikiHighlighter({ themes: [theme, theme], themeKey: 'test' })

  const first = highlighter.highlight({ code: 'const a = 1', language: 'ts' }, () => {})
  expect(first).toBeNull()
  await vi.waitFor(() => expect(engine.failures).toBe(0))

  await expect(highlightOnce(highlighter)).resolves.toMatchObject({ tokens: expect.any(Array) })
})
