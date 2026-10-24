import { createTextDiff, type PreparedDiffSyntaxInput } from '@singapore-editor/diff'
import { TREE_SITTER_LANGUAGE_METADATA } from '@singapore-editor/tree-sitter-languages/metadata'
import { afterEach, describe, expect, test } from 'vitest'

import {
  createHighlightingService,
  type HighlightResult,
  type HighlightTheme,
  type HighlightingService,
  type HighlightingThemeSource,
} from '../src/index'

const services: HighlightingService[] = []
function service(options?: Parameters<typeof createHighlightingService>[0]) {
  const created = createHighlightingService(options)
  services.push(created)
  return created
}

afterEach(async () => {
  await Promise.all(services.splice(0).map((created) => created.dispose()))
})

const PALETTE: HighlightTheme = {
  format: 'editor',
  name: 'test-palette',
  definition: {
    type: 'dark',
    backgroundColor: '#111111',
    foregroundColor: '#eeeeee',
    syntax: {
      keyword: '#aa0000',
      keywordDeclaration: '#aa0000',
      comment: '#00aa00',
      string: '#0000aa',
    },
  },
}

function styleAt(result: HighlightResult, text: string, word: string) {
  const start = text.indexOf(word)
  return result.tokens.find((token) => token.start <= start && token.end > start)?.style
}

describe('built-in palettes color through Tree-sitter captures', () => {
  test('capture variables resolve to the palette, and the snippet session is released', async () => {
    const highlighting = service()
    const text = '// note\nconst s = "x"'
    const pending = highlighting.highlight(text, { language: 'ts', theme: PALETTE })
    expect(highlighting.inspect().snippetSessions).toBe(1)
    const result = await pending

    expect(result.language).toBe('typescript')
    expect(result.background).toBe('#111111')
    expect(styleAt(result, text, 'const')?.color).toBe('#aa0000')
    expect(styleAt(result, text, 'note')).toMatchObject({ color: '#00aa00', fontStyle: 'italic' })
    expect(styleAt(result, text, '"x"')?.color).toBe('#0000aa')
    for (const token of result.tokens) expect(token.style.color).not.toMatch(/var\(/)
    expect(highlighting.inspect().snippetSessions).toBe(0)
  })

  test('languages Tree-sitter lacks keep their Shiki grammar under a palette', async () => {
    const structural = new Set<string>(
      TREE_SITTER_LANGUAGE_METADATA.flatMap((language) => {
        const ids: string[] = [language.id]
        return ids.concat(language.aliases)
      }),
    )
    const language = ['fsharp', 'haskell', 'clojure', 'elixir', 'ocaml'].find(
      (id) => !structural.has(id),
    )!
    const result = await service().highlight('let x = 1', { language, theme: PALETTE })
    expect(result.language).toBe(language)
    expect(result.tokens.length).toBeGreaterThan(0)
  })

  test('a palette revision changes with contributed colors too', () => {
    const highlighting = service()
    const other: HighlightTheme = {
      ...PALETTE,
      definition: { ...PALETTE.definition, colors: { 'syntax.textStrong': '#ffffff' } },
    }
    return Promise.all([
      highlighting.highlight('a', { language: 'ts', theme: PALETTE }),
      highlighting.highlight('a', { language: 'ts', theme: other }),
    ]).then(([first, second]) => expect(first.themeRevision).not.toBe(second.themeRevision))
  })
})

describe('plugin-free highlight', () => {
  test('paints with a real default palette when no theme is named', async () => {
    const text = 'const a = "b"'
    const result = await service().highlight(text, { language: 'typescript' })
    expect(result.background.toLowerCase()).toBe('#24292e')
    const colors = new Set(result.tokens.map((token) => token.style.color?.toLowerCase()))
    expect(colors.size).toBeGreaterThan(2)
  })
})

describe('failures, cancellation and retention', () => {
  test('a crashed worker settles every waiting request with a failure', async () => {
    const crashing = () =>
      new Worker(
        URL.createObjectURL(
          new Blob(['self.onmessage = () => { throw new Error("boom") }'], {
            type: 'text/javascript',
          }),
        ),
      )
    const highlighting = service({ shikiWorker: crashing })
    const theme: HighlightTheme = { format: 'vscode', definition: { name: 'crash' } }
    const results = await Promise.allSettled([
      highlighting.highlight('a', { language: 'ts', theme }),
      highlighting.highlight('b', { language: 'ts', theme }),
    ])
    for (const result of results) {
      expect(result.status).toBe('rejected')
      if (result.status === 'rejected') expect(result.reason.code).toBe('failed')
    }
    expect(highlighting.inspect()).toMatchObject({
      pendingHighlights: 0,
      shiki: { lifecycle: 'crashed', pendingRequests: 0 },
    })
  })

  test('aborting one request leaves a concurrent one on the same grammar to finish', async () => {
    const highlighting = service()
    const theme: HighlightTheme = { format: 'vscode', definition: { name: 'shared' } }
    const controller = new AbortController()
    const aborted = highlighting.highlight('fn main() {}', {
      language: 'rust',
      theme,
      signal: controller.signal,
    })
    const kept = highlighting.highlight('fn main() {}', { language: 'rust', theme })
    controller.abort()
    await expect(aborted).rejects.toMatchObject({ code: 'aborted' })
    expect((await kept).language).toBe('rust')
  })

  test('repeated previews leave no sessions or requests behind', async () => {
    const highlighting = service()
    const vscode: HighlightTheme = { format: 'vscode', definition: { name: 'repeat' } }
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        highlighting.highlight(`const n${index} = ${index}`, {
          language: 'typescript',
          theme: index % 2 ? vscode : PALETTE,
        }),
      ),
    )
    await highlighting.awaitIdle()
    expect(highlighting.inspect()).toMatchObject({
      pendingHighlights: 0,
      snippetSessions: 0,
      shiki: { pendingRequests: 0 },
    })
  })
})

describe('prepared diff syntax', () => {
  const palette: HighlightingThemeSource = { current: () => ({ format: 'editor' }) }
  const diff = (suffix: string) =>
    createTextDiff({
      oldFile: { path: `a${suffix}.ts`, text: `const a${suffix} = 1\n` },
      newFile: { path: `a${suffix}.ts`, text: `const a${suffix} = 2\n` },
    })

  function fakeView() {
    const shown: PreparedDiffSyntaxInput[] = []
    return {
      shown,
      view: {
        setFile: (_file: unknown, prepared: PreparedDiffSyntaxInput = []) => {
          shown.push(prepared)
        },
      },
    }
  }

  test('a kept preparation lends readers to the view and stays owned when it leaves', async () => {
    const highlighting = service()
    const file = diff('1')
    expect(await highlighting.prepareDiff(file, palette)).toBe(true)
    expect(highlighting.canPrepareDiff(file, palette)).toBe(false)
    expect(highlighting.inspect().diffs).toMatchObject({ prepared: 2, running: 0 })

    const { shown, view } = fakeView()
    const shownDiff = highlighting.showDiff(view, file, 'stacked', palette)
    expect(shown[0]).toHaveLength(2)
    expect(highlighting.inspect().diffs).toMatchObject({ prepared: 0, viewed: 1 })
    // A diff on screen is never prepared again.
    expect(await highlighting.prepareDiff(file, palette)).toBe(false)

    await Promise.resolve()
    shownDiff.dispose()
    expect(highlighting.inspect().diffs).toMatchObject({ prepared: 2, viewed: 0 })
  })

  test('a view opened during a preparation awaits it instead of parsing twice', async () => {
    const highlighting = service()
    const file = diff('2')
    const preparing = highlighting.prepareDiff(file, palette)
    expect(highlighting.inspect().diffs.running).toBe(2)
    const { shown, view } = fakeView()
    const shownDiff = highlighting.showDiff(view, file, 'stacked', palette)
    expect(shown[0]).toBeInstanceOf(Promise)
    await preparing
    expect(await shown[0]).toHaveLength(2)
    shownDiff.dispose()
  })

  test('a view that leaves before the preparation lands leaves it kept for the next visit', async () => {
    const highlighting = service()
    const file = diff('3')
    const preparing = highlighting.prepareDiff(file, palette)
    const { shown, view } = fakeView()
    highlighting.showDiff(view, file, 'stacked', palette).dispose()
    expect(await preparing).toBe(true)
    expect(await shown[0]).toEqual([])
    expect(highlighting.inspect().diffs).toMatchObject({ prepared: 2, viewed: 0 })
  })

  test('kept sides are bounded', async () => {
    const highlighting = service()
    for (let index = 0; index < 10; index += 1) {
      await highlighting.prepareDiff(diff(`b${index}`), palette)
    }
    expect(highlighting.inspect().diffs.prepared).toBe(16)
  })
})
