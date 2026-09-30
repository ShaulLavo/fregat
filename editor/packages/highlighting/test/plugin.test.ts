import type {
  EditorDisposable,
  EditorHighlighterProvider,
  EditorPluginContext,
} from '@singapore-editor/core/extensions'
import { describe, expect, test } from 'vitest'

import {
  createHighlightingPlugin,
  createHighlightingService,
  type HighlightingThemeSelection,
} from '../src/index'

type Registrations = {
  highlighters: EditorHighlighterProvider[]
  syntaxProviders: unknown[]
  live: Set<string>
}

function fakeContext(): { context: EditorPluginContext; registrations: Registrations } {
  const registrations: Registrations = { highlighters: [], syntaxProviders: [], live: new Set() }
  const register = (kind: string, list: unknown[], value: unknown): EditorDisposable => {
    list.push(value)
    const key = `${kind}:${list.length}`
    registrations.live.add(key)
    return { dispose: () => registrations.live.delete(key) }
  }
  const context = {
    registerHighlighter: (provider: EditorHighlighterProvider) =>
      register('highlighter', registrations.highlighters, provider),
    registerSyntaxProvider: (provider: unknown) =>
      register('syntax', registrations.syntaxProviders, provider),
    registerSelectionRangeProvider: (provider: unknown) => register('selection', [], provider),
  } as unknown as EditorPluginContext
  return { context, registrations }
}

function activate(
  plugin: ReturnType<typeof createHighlightingPlugin>,
  context: EditorPluginContext,
) {
  return plugin.activate(context) as EditorDisposable
}

describe('createHighlightingPlugin', () => {
  test('a text-only editor gets structure and palette colors with no configuration', () => {
    const { context, registrations } = fakeContext()
    const binding = activate(createHighlightingPlugin(), context)

    expect(registrations.syntaxProviders).toHaveLength(1)
    expect(registrations.highlighters).toHaveLength(0)
    binding.dispose()
    expect(registrations.live.size).toBe(0)
  })

  test('an imported theme adds its colors over Tree-sitter structure and drops them on switch back', () => {
    let selection: HighlightingThemeSelection = { format: 'vscode', id: 'nord' }
    const listeners = new Set<() => void>()
    const service = createHighlightingService({ resolveTheme: async () => ({ name: 'nord' }) })
    const plugin = createHighlightingPlugin({
      service,
      theme: {
        current: () => selection,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      },
    })
    const { context, registrations } = fakeContext()
    const binding = activate(plugin, context)

    expect(registrations.syntaxProviders).toHaveLength(1)
    expect(registrations.highlighters).toHaveLength(1)
    selection = { format: 'editor' }
    for (const listener of listeners) listener()
    expect([...registrations.live].filter((key) => key.startsWith('highlighter'))).toEqual([])

    binding.dispose()
    expect(listeners.size).toBe(0)
    expect(registrations.live.size).toBe(0)
  })

  test('a borrowed service outlives every binding; one owned per activation is disposed with it', async () => {
    const service = createHighlightingService()
    const shared = createHighlightingPlugin({ service })
    const first = activate(shared, fakeContext().context)
    const second = activate(shared, fakeContext().context)
    first.dispose()
    second.dispose()
    expect(service.inspect().disposed).toBe(false)

    const owned = createHighlightingPlugin()
    const left = fakeContext()
    const right = fakeContext()
    const leftBinding = activate(owned, left.context)
    const rightBinding = activate(owned, right.context)
    // Separate activations get separate services, so one teardown cannot stop the other.
    expect(left.registrations.syntaxProviders[0]).not.toBe(right.registrations.syntaxProviders[0])
    leftBinding.dispose()
    expect(right.registrations.live.size).toBeGreaterThan(0)
    rightBinding.dispose()
    await service.dispose()
  })

  test('diffs and prepared documents borrow the same providers the plugin registers', () => {
    const service = createHighlightingService({ resolveTheme: async () => ({ name: 'nord' }) })
    const theme = { current: (): HighlightingThemeSelection => ({ format: 'vscode', id: 'nord' }) }
    const { context, registrations } = fakeContext()
    activate(createHighlightingPlugin({ service, theme }), context)

    const backend = service.documentBackend(theme)
    expect(backend.kind).toBe('highlighter')
    expect(backend.provider).toBe(registrations.highlighters[0])
    expect(service.documentBackend({ current: () => ({ format: 'editor' }) })).toEqual({
      kind: 'tree-sitter',
      provider: registrations.syntaxProviders[0],
    })
  })
})
