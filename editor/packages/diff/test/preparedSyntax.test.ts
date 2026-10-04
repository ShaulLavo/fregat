import { describe, expect, it } from 'vitest'
import {
  createEmptySyntaxResult,
  EditorTokenStore,
  type EditorSyntaxSessionOptions,
  type EditorToken,
} from '@singapore-editor/core/syntax'
import {
  createDiffPlugin,
  createTextDiff,
  joinRenderLines,
  prepareDiffSyntax,
  type DiffFile,
  type DiffSyntaxBackend,
} from '../src'

/**
 * A diff prepared on intent paints coloured with its first rows: the plugin adopts the prepared
 * streams instead of scheduling a parse, and releases its readers when the view leaves.
 */

describe('prepared diff syntax', () => {
  it('adopts prepared streams synchronously, without a parse', async () => {
    const backend = countingBackend()
    const file = typescriptDiff()
    const prepared = await prepareDiffSyntax(file, { backend: backend.backend, side: 'stacked' })
    expect(prepared.map((source) => source.side)).toEqual(['old', 'new'])
    const sessions = backend.sessions

    const plugin = createDiffPlugin({
      mode: 'document',
      side: 'stacked',
      syntaxBackend: backend.backend,
    })
    plugin.setFile(file, prepared)

    expect(plugin.isSyntaxReady()).toBe(true)
    expect(tokenTexts(plugin.getTokens(), joinRenderLines(plugin.getRows()))).toEqual([
      'old',
      'new',
    ])
    await flushPromises()
    expect(backend.sessions).toBe(sessions)
  })

  it('plain syntax release disposes owned sessions while retaining rows and expansion', async () => {
    const backend = countingBackend()
    const file = typescriptDiff()
    const prepared = await prepareDiffSyntax(file, { backend: backend.backend })
    const plugin = createDiffPlugin({ mode: 'document', syntaxBackend: backend.backend })
    plugin.setFile(file, prepared)
    const key = plugin.getRows().find((row) => row.expandKey)?.expandKey
    expect(key).toBeDefined()
    if (!key) return
    plugin.toggleRegion(key)
    const rows = plugin.getRows()
    plugin.releaseSyntax()
    expect(plugin.getTokens()).toEqual([])
    expect(plugin.getRows()).toBe(rows)
    expect(plugin.getExpandedRegions().has(key)).toBe(true)
    expect(backend.disposed).toBe(2)
    plugin.releaseSyntax()
    plugin.setFile(null)
    expect(backend.disposed).toBe(2)
  })

  it('parses and disposes prepared streams that do not cover the pane side', async () => {
    const backend = countingBackend()
    const file = typescriptDiff()
    const prepared = await prepareDiffSyntax(file, { backend: backend.backend, side: 'new' })

    const plugin = createDiffPlugin({
      mode: 'document',
      side: 'old',
      syntaxBackend: backend.backend,
    })
    plugin.setFile(file, prepared)

    expect(plugin.isSyntaxReady()).toBe(false)
    expect(backend.disposed).toBe(1)
    await flushUntil(() => plugin.isSyntaxReady())
    expect(tokenTexts(plugin.getTokens(), joinRenderLines(plugin.getRows()))).toEqual(['old'])
  })

  it('keeps prepared streams coloured across a theme change, adopted or not', async () => {
    const theme = themedBackend()
    const prepared = await prepareDiffSyntax(typescriptDiff(), { backend: theme.backend })

    theme.change('blue')
    await flushUntil(() => prepared.every((source) => source.tokens.styles[0]?.color === 'blue'))
    expect(prepared.map((source) => source.tokens.styles[0]?.color)).toEqual(['blue', 'blue'])

    const plugin = createDiffPlugin({
      mode: 'document',
      side: 'stacked',
      syntaxBackend: theme.backend,
    })
    plugin.setFile(typescriptDiff(), prepared)
    theme.change('green')
    await flushUntil(() => plugin.getTokens()[0]?.style.color === 'green')
    expect(plugin.getTokens().every((token) => token.style.color === 'green')).toBe(true)

    plugin.setFile(null)
    expect(theme.listeners.size).toBe(0)
  })

  it('awaits a preparation still running instead of parsing the file again', async () => {
    const backend = countingBackend()
    const file = typescriptDiff()
    const preparing = prepareDiffSyntax(file, { backend: backend.backend })
    const plugin = createDiffPlugin({
      mode: 'document',
      side: 'stacked',
      syntaxBackend: backend.backend,
    })
    let notified = 0
    plugin.onDidChangeTokens(() => {
      notified += 1
    })

    plugin.setFile(file, preparing)
    expect(plugin.isSyntaxReady()).toBe(false)
    await flushUntil(() => plugin.isSyntaxReady())

    expect(plugin.getTokens()).toHaveLength(2)
    expect(notified).toBe(1)
    expect(backend.sessions).toBe(2)
  })

  it('rejects an older preparation when the same file object is attached again', async () => {
    const theme = themedBackend()
    const file = typescriptDiff()
    const older = await prepareDiffSyntax(file, { backend: theme.backend })
    const newer = await prepareDiffSyntax(file, { backend: theme.backend })
    const first = Promise.withResolvers<Awaited<ReturnType<typeof prepareDiffSyntax>>>()
    const second = Promise.withResolvers<Awaited<ReturnType<typeof prepareDiffSyntax>>>()
    const plugin = createDiffPlugin({ mode: 'document', syntaxBackend: theme.backend })
    plugin.setFile(file, first.promise)
    plugin.setFile(file, second.promise)
    first.resolve(older)
    await flushPromises()
    expect(plugin.isSyntaxReady()).toBe(false)
    expect(plugin.getTokens()).toEqual([])
    second.resolve(newer)
    await flushUntil(() => plugin.isSyntaxReady())
    expect(plugin.getTokens()).toHaveLength(2)
    expect(theme.listeners.size).toBe(2)
    plugin.setFile(null)
    expect(theme.listeners.size).toBe(0)
  })

  it('disposes a late preparation for a file the view has left', async () => {
    const backend = countingBackend()
    const file = typescriptDiff()
    let finish!: () => void
    const gate = new Promise<void>((resolve) => {
      finish = resolve
    })
    const preparing = gate.then(() => prepareDiffSyntax(file, { backend: backend.backend }))
    const plugin = createDiffPlugin({
      mode: 'document',
      side: 'stacked',
      syntaxBackend: backend.backend,
    })

    plugin.setFile(file, preparing)
    plugin.setFile(null)
    finish()
    await preparing
    await flushPromises()

    expect(backend.disposed).toBe(2)
  })

  it.each(['empty', 'disabled', 'overlay'] as const)(
    'handles a rejected preparation when the pane is %s',
    async (pane) => {
      const plugin = createDiffPlugin({
        mode: pane === 'overlay' ? 'overlay' : 'document',
        syntaxHighlight: pane !== 'disabled',
      })
      plugin.setFile(
        pane === 'empty' ? null : typescriptDiff(),
        Promise.reject(new Error('preparation failed')),
      )
      await flushPromises()
      expect(plugin.getTokens()).toEqual([])
    },
  )

  it('an aborted preparation resolves empty and keeps no session', async () => {
    const backend = countingBackend()
    const controller = new AbortController()
    const preparing = prepareDiffSyntax(typescriptDiff(), {
      backend: backend.backend,
      signal: controller.signal,
    })
    controller.abort()

    await expect(preparing).resolves.toEqual([])
    expect(backend.disposed).toBe(backend.sessions)
  })
})

function typescriptDiff(): DiffFile {
  return createTextDiff({
    contextLines: 0,
    oldFile: { path: 'note.ts', text: 'keep\nold\nskip\n', languageId: 'typescript' },
    newFile: { path: 'note.ts', text: 'keep\nnew\nskip\n', languageId: 'typescript' },
  })
}

function countingBackend() {
  const counts = { sessions: 0, disposed: 0 }
  const backend: DiffSyntaxBackend = {
    kind: 'tree-sitter',
    provider: {
      createSession(options) {
        counts.sessions += 1
        const result = () => syntaxResultForOptions(options)
        return {
          foldingSupport: 'supported',
          applyChange: async () => result(),
          dispose: () => {
            counts.disposed += 1
          },
          getResult: result,
          getSnapshotVersion: () => 0,
          getTokens: () => result().tokens,
          refresh: async () => result(),
        }
      },
    },
  }
  return {
    backend,
    get sessions() {
      return counts.sessions
    },
    get disposed() {
      return counts.disposed
    },
  }
}

function themedBackend() {
  const listeners = new Set<() => void>()
  let color = 'red'
  const refresh = async () => ({
    tokens: EditorTokenStore.fromTokens([{ start: 5, end: 8, style: { color } }]),
  })
  const backend: DiffSyntaxBackend = {
    kind: 'highlighter',
    provider: {
      createSession: () => ({
        refresh,
        applyChange: refresh,
        dispose: () => undefined,
        onDidChangeTheme: (listener: () => void) => {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
      }),
    },
  }
  return {
    backend,
    listeners,
    change(next: string) {
      color = next
      for (const listener of listeners) listener()
    },
  }
}

function syntaxResultForOptions(options: EditorSyntaxSessionOptions) {
  const target = options.documentId.endsWith('#diff-old') ? 'old' : 'new'
  const start = options.textSnapshot.materializeFullText().indexOf(target)
  const tokens: EditorToken[] =
    start === -1 ? [] : [{ end: start + target.length, start, style: { color: 'rgb(1, 2, 3)' } }]
  return { ...createEmptySyntaxResult(), tokens }
}

function tokenTexts(tokens: readonly EditorToken[], text: string): string[] {
  return tokens.map((token) => text.slice(token.start, token.end))
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function flushUntil(done: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (done()) return
    await flushPromises()
  }
}
