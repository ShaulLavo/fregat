import { describe, expect, test, vi } from 'vitest'
import { EditorTokenStore } from '@singapore-editor/core/syntax'
import {
  createDiffRegionStore,
  createDiffPlugin,
  createTextDiff,
  type DiffSyntaxBackend,
} from '@singapore-editor/diff'
import { DiffSyntaxStore } from '../src/diffs'

const collisionA = "const x='okoxbtwwfyxtamfh';"
const collisionB = "const x='etgmlhqnbyctfdgo';"
const scope = 'same-owner'

function diff(text = collisionA) {
  return createTextDiff({
    oldFile: { path: 'input.js', text: 'const previous = 1;', languageId: 'javascript' },
    newFile: { path: 'input.js', text, languageId: 'javascript' },
  })
}

function providerBoundary(
  gate = Promise.resolve(),
  documentColor?: (documentId: string) => string,
) {
  const counts = { sessions: 0, refreshes: 0, disposed: 0 }
  const backend: DiffSyntaxBackend = {
    kind: 'highlighter',
    provider: {
      createSession: (options) => {
        counts.sessions += 1
        const refresh = async () => {
          counts.refreshes += 1
          await gate
          const text = options.textSnapshot.readRange(0, options.textSnapshot.length)
          return {
            tokens: EditorTokenStore.fromTokens([
              {
                start: 0,
                end: 5,
                style: {
                  color:
                    documentColor?.(options.documentId) ?? (text === collisionB ? 'blue' : 'red'),
                },
              },
            ]),
          }
        }
        return {
          refresh,
          applyChange: refresh,
          dispose: () => {
            counts.disposed += 1
          },
        }
      },
    },
  }
  return { backend, counts }
}

function plugin(backend: DiffSyntaxBackend) {
  return createDiffPlugin({ mode: 'document', side: 'stacked', syntaxBackend: backend })
}

describe('exact diff syntax store', () => {
  test('known-good equal recreated sources reuse a warm preparation', async () => {
    const store = new DiffSyntaxStore()
    const { backend, counts } = providerBoundary()
    const view = plugin(backend)
    try {
      expect(await store.prepare(diff(), scope, backend)).toBe(true)
      expect(store.canPrepare(diff(), scope, backend)).toBe(false)
      const shown = store.show(view, diff(), 'stacked', scope, backend)
      expect(view.isSyntaxReady()).toBe(true)
      expect(view.getTokens()).toHaveLength(2)
      shown.dispose()
      expect(counts).toEqual({ sessions: 2, refreshes: 2, disposed: 0 })
    } finally {
      view.setFile(null)
      store.dispose()
    }
    expect(counts.disposed).toBe(2)
  })

  test('known-good unequal noncolliding sources prepare separately', async () => {
    const store = new DiffSyntaxStore()
    const { backend, counts } = providerBoundary()
    try {
      await store.prepare(diff(), scope, backend)
      expect(store.canPrepare(diff('const other = 2;'), scope, backend)).toBe(true)
      expect(await store.prepare(diff('const other = 2;'), scope, backend)).toBe(true)
      expect(counts.sessions).toBeGreaterThan(2)
    } finally {
      store.dispose()
    }
  })

  test.each([
    ['input.ts', 'input.tsx', 'typescript'],
    ['input.js', 'input.jsx', 'javascript'],
    ['first/input.ts', 'second/input.ts', 'typescript'],
    ['first.custom', 'second.custom', 'custom-language'],
  ])('provider paths %s and %s qualify equal text with %s', async (path, nextPath, languageId) => {
    const store = new DiffSyntaxStore()
    const { backend, counts } = providerBoundary(Promise.resolve(), (documentId) => documentId)
    const view = plugin(backend)
    const first = { ...diff(), path, languageId }
    const next = { ...first, path: nextPath }
    try {
      await store.prepare(first, scope, backend)
      expect(store.canPrepare({ ...first }, scope, backend)).toBe(false)
      expect(store.canPrepare(next, scope, backend)).toBe(true)
      const shown = store.show(view, next, 'stacked', scope, backend)
      await vi.waitFor(() => expect(view.isSyntaxReady()).toBe(true))
      expect(view.getTokens()[0]?.style.color).toBe(`${nextPath}#diff-old`)
      expect(counts.sessions).toBe(4)
      shown.dispose()
    } finally {
      view.setFile(null)
      store.dispose()
    }
    expect(counts.disposed).toBe(4)
  })

  test('equal-length FNV collision never admits the other source tokens', async () => {
    const store = new DiffSyntaxStore()
    const { backend } = providerBoundary()
    const view = plugin(backend)
    try {
      expect(collisionA.length).toBe(collisionB.length)
      await store.prepare(diff(), scope, backend)
      expect(store.canPrepare(diff(collisionB), scope, backend)).toBe(true)
      await store.prepare(diff(collisionB), scope, backend)
      const shown = store.show(view, diff(collisionB), 'stacked', scope, backend)
      expect(view.getTokens().at(-1)?.style.color).toBe('blue')
      shown.dispose()
    } finally {
      view.setFile(null)
      store.dispose()
    }
  })

  test('two views share active sources and releasing one preserves the survivor', async () => {
    const store = new DiffSyntaxStore()
    const { backend, counts } = providerBoundary()
    const first = plugin(backend)
    const second = plugin(backend)
    try {
      await store.prepare(diff(), scope, backend)
      const a = store.show(first, diff(), 'stacked', scope, backend)
      const b = store.show(second, diff(), 'stacked', scope, backend)
      await vi.waitFor(() => expect(second.isSyntaxReady()).toBe(true))
      expect(counts.sessions).toBe(2)
      expect(second.getTokens()).toEqual(first.getTokens())
      a.dispose()
      first.setFile(null)
      expect(counts.disposed).toBe(0)
      expect(second.getTokens()).toHaveLength(2)
      b.dispose()
      second.setFile(null)
      store.dispose()
      expect(counts.disposed).toBe(2)
    } finally {
      first.setFile(null)
      second.setFile(null)
      store.dispose()
    }
  })
  test('an unprepared collision source receives its own tokens when shown', async () => {
    const store = new DiffSyntaxStore()
    const { backend } = providerBoundary()
    const view = plugin(backend)
    try {
      await store.prepare(diff(), scope, backend)
      const shown = store.show(view, diff(collisionB), 'stacked', scope, backend)
      await vi.waitFor(() => expect(view.isSyntaxReady()).toBe(true))
      expect(view.getTokens().at(-1)?.style.color).toBe('blue')
      shown.dispose()
    } finally {
      view.setFile(null)
      store.dispose()
    }
  })

  test('cancelled hover and one departing view leave the other pending interest alive', async () => {
    const gate = Promise.withResolvers<void>()
    const store = new DiffSyntaxStore()
    const { backend, counts } = providerBoundary(gate.promise)
    const hover = new AbortController()
    const first = plugin(backend)
    const second = plugin(backend)
    const preparing = store.prepare(diff(), scope, backend, hover.signal)
    const a = store.show(first, diff(), 'stacked', scope, backend)
    const b = store.show(second, diff(), 'stacked', scope, backend)
    hover.abort()
    expect(await preparing).toBe(false)
    a.dispose()
    expect(counts.disposed).toBe(0)
    gate.resolve()
    await vi.waitFor(() => expect(second.isSyntaxReady()).toBe(true))
    expect(first.getTokens()).toEqual([])
    expect(second.getTokens()).toHaveLength(2)
    expect(counts.sessions).toBe(2)
    b.dispose()
    store.dispose()
    expect(counts.disposed).toBe(2)
  })

  test('the last pending interest disposes sessions and rejects late completion', async () => {
    const gate = Promise.withResolvers<void>()
    const store = new DiffSyntaxStore()
    const { backend, counts } = providerBoundary(gate.promise)
    const hover = new AbortController()
    const preparing = store.prepare(diff(), scope, backend, hover.signal)
    await vi.waitFor(() => expect(counts.refreshes).toBe(2))
    hover.abort()
    expect(await preparing).toBe(false)
    expect(counts.disposed).toBe(2)
    gate.resolve()
    await vi.waitFor(() =>
      expect(store.inspect()).toMatchObject({ prepared: 0, running: 0, borrowed: 0 }),
    )
    expect(await store.prepare(diff(), scope, backend)).toBe(true)
    expect(counts.sessions).toBe(4)
    store.dispose()
    expect(counts.disposed).toBe(4)
  })

  test('plugin detachment releases its reader interests before binding cleanup', async () => {
    const store = new DiffSyntaxStore()
    const { backend, counts } = providerBoundary()
    const view = plugin(backend)
    await store.prepare(diff(), scope, backend)
    const shown = store.show(view, diff(), 'stacked', scope, backend)
    expect(store.inspect().borrowed).toBe(2)
    view.setFile(null)
    expect(store.inspect()).toMatchObject({ borrowed: 0, prepared: 2 })
    shown.dispose()
    shown.dispose()
    store.dispose()
    store.dispose()
    expect(counts.disposed).toBe(2)
  })

  test('terminal disposal ends active and pending work without recreating sources', async () => {
    const gate = Promise.withResolvers<void>()
    const store = new DiffSyntaxStore()
    const { backend, counts } = providerBoundary(gate.promise)
    const view = plugin(backend)
    const preparing = store.prepare(diff(), scope, backend)
    const shown = store.show(view, diff(), 'stacked', scope, backend)
    await vi.waitFor(() => expect(counts.refreshes).toBe(2))
    let outcome: boolean | undefined
    void preparing.then((value) => {
      outcome = value
    })
    store.dispose()
    store.dispose()
    expect(counts.disposed).toBe(2)
    try {
      await vi.waitFor(() => expect(outcome).toBe(false), { timeout: 100 })
    } finally {
      gate.resolve()
    }
    expect(await preparing).toBe(false)
    expect(store.canPrepare(diff(), scope, backend)).toBe(false)
    expect(await store.prepare(diff(), scope, backend)).toBe(false)
    store.show(view, diff(), 'stacked', scope, backend).dispose()
    shown.dispose()
    expect(view.getTokens()).toEqual([])
    expect(store.inspect()).toEqual({
      prepared: 0,
      running: 0,
      viewed: 0,
      borrowed: 0,
      retainedInputCodeUnits: 0,
    })
    expect(counts.sessions).toBe(2)
  })

  test('provider and scoped theme compatibility both qualify equality', async () => {
    const store = new DiffSyntaxStore()
    const first = providerBoundary()
    const second = providerBoundary()
    await store.prepare(diff(), scope, first.backend)
    expect(store.canPrepare(diff(), scope, second.backend)).toBe(true)
    expect(store.canPrepare(diff(), 'other-theme', first.backend)).toBe(true)
    await store.prepare(diff(), scope, second.backend)
    await store.prepare(diff(), 'other-theme', first.backend)
    expect(first.counts.sessions).toBe(4)
    expect(second.counts.sessions).toBe(2)
    store.dispose()
  })

  test('active sides stay pinned while only sixteen idle sides are retained', async () => {
    const store = new DiffSyntaxStore()
    const { backend, counts } = providerBoundary()
    const view = plugin(backend)
    await store.prepare(diff(), scope, backend)
    const shown = store.show(view, diff(), 'stacked', scope, backend)
    for (let index = 0; index < 10; index += 1) {
      const file = createTextDiff({
        oldFile: { path: 'input.js', text: `const old${index} = 1;` },
        newFile: { path: 'input.js', text: `const new${index} = 2;` },
      })
      await store.prepare(file, scope, backend)
    }
    expect(store.inspect()).toMatchObject({ prepared: 16, borrowed: 2, viewed: 1 })
    expect(view.getTokens()).toHaveLength(2)
    expect(counts.sessions - counts.disposed).toBe(18)
    shown.dispose()
    expect(store.inspect()).toMatchObject({ prepared: 16, borrowed: 0, viewed: 0 })
    store.dispose()
    expect(counts.disposed).toBe(counts.sessions)
  })

  test('warm equality never serializes lines and inspection charges the retained input', async () => {
    const store = new DiffSyntaxStore()
    const { backend, counts } = providerBoundary()
    const file = diff()
    await store.prepare(file, scope, backend)
    const lines = (input: readonly string[]) =>
      new Proxy(input, {
        get(target, property, receiver) {
          expect(property).not.toBe('join')
          return Reflect.get(target, property, receiver)
        },
      })
    const recreated = {
      ...file,
      oldLines: lines(file.oldLines.slice()),
      newLines: lines(file.newLines.slice()),
    }
    const view = plugin(backend)
    expect(store.canPrepare(recreated, scope, backend)).toBe(false)
    const shown = store.show(view, recreated, 'stacked', scope, backend)
    expect(view.isSyntaxReady()).toBe(true)
    expect(counts.sessions).toBe(2)
    expect(store.inspect().retainedInputCodeUnits).toBe(
      file.oldLines.concat(file.newLines).join('').length,
    )
    shown.dispose()
    store.dispose()
  })

  test('partial sources never prepare full immutable syntax', async () => {
    const store = new DiffSyntaxStore()
    const { backend, counts } = providerBoundary()
    const file = { ...diff(), isPartial: true }
    expect(await store.prepare(file, scope, backend)).toBe(false)
    const view = plugin(backend)
    store.show(view, file, 'stacked', scope, backend).dispose()
    await Promise.resolve()
    expect(counts.sessions).toBe(0)
    store.dispose()
  })
  test('provider failure rejects preparation, disposes sessions and leaves no failed cache', async () => {
    const store = new DiffSyntaxStore()
    const { backend, counts } = providerBoundary(Promise.reject('provider-boundary-failure'))
    try {
      await expect(store.prepare(diff(), scope, backend)).rejects.toBe('provider-boundary-failure')
      expect(store.inspect()).toMatchObject({ prepared: 0, running: 0, borrowed: 0 })
      expect(counts.disposed).toBe(counts.sessions)
      expect(store.canPrepare(diff(), scope, backend)).toBe(true)
    } finally {
      store.dispose()
    }
  })
  test('releasing one syntax binding preserves the surviving split pane expansion', async () => {
    const store = new DiffSyntaxStore()
    const { backend } = providerBoundary()
    const file = createTextDiff({
      contextLines: 0,
      oldFile: { path: 'input.js', text: 'keep\nold\nskip\n' },
      newFile: { path: 'input.js', text: 'keep\nnew\nskip\n' },
    })
    const regions = createDiffRegionStore()
    const first = createDiffPlugin({
      mode: 'document',
      side: 'old',
      regions,
      syntaxBackend: backend,
    })
    const second = createDiffPlugin({
      mode: 'document',
      side: 'new',
      regions,
      syntaxBackend: backend,
    })
    await store.prepare(file, scope, backend)
    const a = store.show(first, file, 'old', scope, backend)
    const b = store.show(second, file, 'new', scope, backend)
    const key = first.getRows().find((row) => row.expandKey)?.expandKey
    expect(key).toBeDefined()
    if (!key) return
    first.toggleRegion(key)
    expect(second.getExpandedRegions().has(key)).toBe(true)
    const rows = second.getRows()
    a.dispose()
    expect(second.getExpandedRegions().has(key)).toBe(true)
    expect(second.getRows()).toBe(rows)
    b.dispose()
    first.setFile(null)
    second.setFile(null)
    store.dispose()
  })
})
