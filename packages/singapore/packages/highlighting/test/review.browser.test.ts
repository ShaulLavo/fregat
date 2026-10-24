import { retainHighlighter } from './fixtures/document'
import type { VscodeThemeRegistration } from '@singapore-editor/core/shiki'
import {
  createTextDiff,
  type PreparedDiffSyntaxInput,
  type DiffSyntaxSourceReader,
} from '@singapore-editor/diff'
import { afterEach, describe, expect, test } from 'vitest'
import { commands } from 'vitest/browser'

import {
  createHighlightingService,
  type HighlightResult,
  type HighlightTheme,
  type HighlightingService,
  type HighlightingThemeSource,
} from '../src/index'

declare module 'vitest/browser' {
  interface BrowserCommands {
    blockRequests(pattern: string): Promise<void>
    unblockRequests(pattern: string): Promise<void>
    holdRequests(pattern: string): Promise<void>
    releaseRequests(pattern: string): Promise<void>
  }
}

const services: HighlightingService[] = []
function service(options?: Parameters<typeof createHighlightingService>[0]) {
  const created = createHighlightingService(options)
  services.push(created)
  return created
}

afterEach(async () => {
  await Promise.all(services.splice(0).map((created) => created.dispose()))
})

function keywordTheme(color: string, name = 'mine'): VscodeThemeRegistration {
  return {
    name,
    type: 'dark',
    tokenColors: [{ scope: ['keyword', 'storage'], settings: { foreground: color } }],
  }
}

function colorOf(result: HighlightResult, text: string, word: string) {
  const start = text.indexOf(word)
  return result.tokens
    .find((token) => token.start <= start && token.end > start)
    ?.style.color?.toLowerCase()
}

describe('content revisions', () => {
  test('a document recolours when the same theme id resolves to new content', async () => {
    let registration = keywordTheme('#ff0000')
    const listeners = new Set<() => void>()
    const source: HighlightingThemeSource = {
      current: () => ({ format: 'vscode', id: 'mine' }),
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }
    const highlighting = service({ resolveTheme: async () => registration })
    const text = 'const a = 1'
    const retained = retainHighlighter(highlighting.highlighterProvider(source), text)
    const { session, buffer } = retained
    const changed = new Promise<void>((resolve) => session.onDidChangeTheme?.(resolve))
    const keyword = async () => {
      const { tokens } = await session.refresh(buffer.getTextSnapshot())
      return tokens
        .toTokens()
        .find((token) => token.start === 0)
        ?.style.color?.toLowerCase()
    }
    try {
      expect(await keyword()).toBe('#ff0000')
      registration = keywordTheme('#0000ff')
      for (const listener of listeners) listener()
      await changed
      expect(await keyword()).toBe('#0000ff')
    } finally {
      retained.dispose()
    }
  })

  test('a prepared diff recolours when the same theme id resolves to new content', async () => {
    let registration = keywordTheme('#ff0000')
    const listeners = new Set<() => void>()
    const source: HighlightingThemeSource = {
      current: () => ({ format: 'vscode', id: 'mine' }),
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }
    const highlighting = service({ resolveTheme: async () => registration })
    const file = createTextDiff({
      oldFile: { path: 'p.ts', languageId: 'typescript', text: 'const p = 1\n' },
      newFile: { path: 'p.ts', languageId: 'typescript', text: 'const p = 2\n' },
    })
    expect(await highlighting.prepareDiff(file, source)).toBe(true)
    let sources: readonly DiffSyntaxSourceReader[] = []
    const shown = highlighting.showDiff(
      {
        setFile: (_file, prepared = []) =>
          void Promise.resolve(prepared).then((s) => (sources = s)),
      },
      file,
      'new',
      source,
    )
    await Promise.resolve()
    const keyword = () =>
      sources[0]?.tokens
        .toTokens()
        .find((token) => token.start === 0)
        ?.style.color?.toLowerCase()
    expect(keyword()).toBe('#ff0000')

    const recoloured = new Promise<void>((resolve) => sources[0]?.onDidChangeTokens(resolve))
    registration = keywordTheme('#0000ff')
    for (const listener of listeners) listener()
    await recoloured
    expect(keyword()).toBe('#0000ff')
    shown.dispose()
  })

  test('a snippet theme reused after its content changed gets the new revision and colours', async () => {
    const highlighting = service()
    const definition = { ...keywordTheme('#ff0000') }
    const theme: HighlightTheme = { format: 'vscode', definition }
    const text = 'const a = 1'
    const first = await highlighting.highlight(text, { language: 'typescript', theme })
    Object.assign(definition, keywordTheme('#0000ff'))
    const second = await highlighting.highlight(text, { language: 'typescript', theme })

    expect(colorOf(first, text, 'const')).toBe('#ff0000')
    expect(second.themeRevision).not.toBe(first.themeRevision)
    expect(colorOf(second, text, 'const')).toBe('#0000ff')
  })
})

describe('named palette colours', () => {
  test('named colours win over the shorthand fields, as the editor paints them', async () => {
    const text = 'const a = "x"'
    const result = await service().highlight(text, {
      language: 'typescript',
      theme: {
        format: 'editor',
        definition: {
          type: 'dark',
          foregroundColor: '#111111',
          backgroundColor: '#222222',
          syntax: { keyword: '#ff0000', keywordDeclaration: '#ff0000', string: '#00ff00' },
          colors: {
            foreground: '#eeeeee',
            background: '#010101',
            'syntax.keywordDeclaration': '#0000ff',
          },
        },
      },
    })
    expect(result.foreground).toBe('#eeeeee')
    expect(result.background).toBe('#010101')
    expect(colorOf(result, text, 'const')).toBe('#0000ff')
    expect(colorOf(result, text, '"x"')).toBe('#00ff00')
  })

  test('named-only surface colours reach a snippet', async () => {
    const result = await service().highlight('a', {
      language: 'typescript',
      theme: {
        format: 'editor',
        definition: { colors: { foreground: '#abcdef', background: '#123456' } },
      },
    })
    expect(result).toMatchObject({ foreground: '#abcdef', background: '#123456' })
  })
})

describe('grammar acquisition', () => {
  // Chromium keeps a failed module import for the page's lifetime, so this grammar recovers on the
  // next page load; the service holds no failure and keeps serving other grammars.
  test('a known grammar that fails to load rejects instead of answering plain text', async () => {
    const highlighting = service()
    const theme: HighlightTheme = { format: 'vscode', definition: keywordTheme('#ff0000') }
    await commands.blockRequests('erlang')
    try {
      await expect(
        highlighting.highlight('-module(a).', { language: 'erlang', theme }),
      ).rejects.toMatchObject({ code: 'failed' })
    } finally {
      await commands.unblockRequests('erlang')
    }
    const other = await highlighting.highlight('fn main() {}', { language: 'rust', theme })
    expect(other.language).toBe('rust')
    expect(highlighting.inspect().pendingHighlights).toBe(0)
  })

  test('an unknown language is still plain text', async () => {
    const result = await service().highlight('x', {
      language: 'no-such-language',
      theme: { format: 'vscode', definition: keywordTheme('#ff0000') },
    })
    expect(result).toMatchObject({ language: 'text', tokens: [] })
  })

  test('disposal settles a highlight waiting on grammar acquisition', async () => {
    const highlighting = service()
    await commands.holdRequests('ruby')
    try {
      const pending = highlighting.highlight('puts 1', {
        language: 'ruby',
        theme: { format: 'vscode', definition: keywordTheme('#ff0000') },
      })
      const settled = pending.then(
        () => 'fulfilled',
        (error: { code?: string }) => error.code,
      )
      await new Promise((resolve) => setTimeout(resolve, 50))
      await highlighting.dispose()
      expect(highlighting.inspect().pendingHighlights).toBe(0)
      expect(await settled).toBe('disposed')
    } finally {
      await commands.releaseRequests('ruby')
    }
  })
})

describe('prepared diffs after disposal', () => {
  const palette: HighlightingThemeSource = { current: () => ({ format: 'editor' }) }
  const diff = (suffix: string) =>
    createTextDiff({
      oldFile: { path: `r${suffix}.ts`, text: `const r${suffix} = 1\n` },
      newFile: { path: `r${suffix}.ts`, text: `const r${suffix} = 2\n` },
    })

  function holdingView() {
    let claim: PreparedDiffSyntaxInput = []
    return {
      claimed: () => Promise.resolve(claim),
      view: {
        setFile: (_file: unknown, prepared: PreparedDiffSyntaxInput = []) => {
          claim = prepared
        },
      },
    }
  }

  test('terminal disposal releases active readers and never refills the store', async () => {
    const highlighting = service()
    const file = diff('1')
    expect(await highlighting.prepareDiff(file, palette)).toBe(true)
    const { claimed, view } = holdingView()
    const shown = highlighting.showDiff(view, file, 'stacked', palette)
    const sources = await claimed()
    expect(sources).toHaveLength(2)

    await highlighting.dispose()
    expect(highlighting.inspect().diffs).toMatchObject({ prepared: 0, borrowed: 0, viewed: 0 })
    for (const source of sources) source.dispose()
    shown.dispose()
    expect(highlighting.inspect().diffs.prepared).toBe(0)
  })

  test('a preparation that settles after disposal is disposed and never kept', async () => {
    const highlighting = service()
    const preparing = highlighting.prepareDiff(diff('2'), palette)
    await highlighting.dispose()
    expect(await preparing).toBe(false)
    expect(highlighting.inspect().diffs).toMatchObject({ prepared: 0, running: 0 })
  })
})
