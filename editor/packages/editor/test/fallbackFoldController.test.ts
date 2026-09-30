import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDocumentSession } from '../src/documentSession'
import { EditorFallbackFoldController } from '../src/editor/fallbackFoldController'
import { IndentationFoldIndex } from '../src/editor/indentationFoldIndex'
import { EditorSecondaryWorkScheduler } from '../src/editor/secondaryWorkScheduler'
import { createTextEditBatch } from '../src/textEditBatch'

type Context = ReturnType<ConstructorParameters<typeof EditorFallbackFoldController>[0]['context']>

const disposers: Array<() => void> = []

beforeEach(() => vi.useFakeTimers())

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('snapshot fallback fold lifecycle', () => {
  it('finishes a cold offscreen fold synchronously on explicit demand', () => {
    const fixture = controller('root\n' + '  child\n'.repeat(4_000) + 'next')
    fixture.folds.schedule()

    fixture.folds.flush()

    expect(fixture.folds.index?.ready).toBe(true)
    expect(fixture.folds.index?.ancestors(3_500)).toMatchObject([{ startLine: 0, endLine: 4_000 }])
    expect(fixture.logs).toContainEqual(
      expect.objectContaining({
        trigger: 'explicit-command',
        outcome: 'completed',
        materializations: 0,
      }),
    )
    const ready = fixture.folds.index
    vi.runAllTimers()
    expect(fixture.folds.index).toBe(ready)
  })

  it('discards a yielded generation when the document is replaced', () => {
    const fixture = controller('root\n  child\n'.repeat(4_000))
    fixture.folds.schedule()
    vi.advanceTimersByTime(150)
    expect(fixture.folds.index).toBeNull()
    const replacement = createDocumentSession('replacement\n  child\nend')
    const snapshot = replacement.getTextSnapshot()
    fixture.setContext({ snapshot, documentVersion: 2 })

    fixture.folds.schedule()
    vi.runAllTimers()

    expect(fixture.folds.index?.snapshot).toBe(snapshot)
    expect(fixture.published.filter((index) => index !== null)).toEqual([fixture.folds.index])
    expect(fixture.logs).toContainEqual(
      expect.objectContaining({
        documentVersion: 1,
        outcome: 'cancelled',
      }),
    )
  })

  it('releases a yielded generation when its owner is disposed', () => {
    const fixture = controller('root\n  child\n'.repeat(4_000))
    fixture.folds.schedule()
    vi.advanceTimersByTime(150)
    expect(fixture.folds.index).toBeNull()

    fixture.dispose()
    vi.runAllTimers()

    expect(fixture.folds.index).toBeNull()
    expect(fixture.published.filter((index) => index !== null)).toEqual([])
    expect(fixture.logs).toContainEqual(expect.objectContaining({ outcome: 'cancelled' }))
  })

  it('rebuilds the same snapshot when effective tab width changes', () => {
    const fixture = controller('  header\n\tchild\nnext')
    fixture.setContext({ tabSize: 2 })
    fixture.folds.flush()
    const first = fixture.folds.index
    expect(first?.count).toBe(0)

    fixture.setContext({ tabSize: 4 })
    fixture.folds.schedule()
    vi.runAllTimers()

    expect(fixture.folds.index).not.toBe(first)
    expect(fixture.folds.index?.snapshot).toBe(first?.snapshot)
    expect(fixture.folds.index?.all()).toMatchObject([{ startLine: 0, endLine: 1 }])
  })

  it('cancels unfinished work when structural folding becomes pending', () => {
    const fixture = controller('root\n  child\n'.repeat(4_000))
    fixture.folds.schedule()
    vi.advanceTimersByTime(150)
    fixture.setContext({
      selection: {
        ...fixture.context().selection,
        reason: null,
        provider: 'plugin',
        foldingSupport: 'pending',
        structuralStatus: 'loading',
        structuralSession: true,
        structuralSuppression: true,
      },
    })

    fixture.folds.schedule()
    vi.runAllTimers()

    expect(fixture.folds.index).toBeNull()
    expect(fixture.published.filter((index) => index !== null)).toEqual([])
    expect(fixture.logs).toContainEqual(expect.objectContaining({ outcome: 'cancelled' }))
  })

  it('reports a cold rebuild when an edit batch does not follow the indexed snapshot', () => {
    const fixture = controller('root\n  child\nnext')
    fixture.folds.flush()
    fixture.session.applyEdits([{ from: 7, to: 8, text: 'X' }])
    const before = fixture.session.getTextSnapshot()
    const edits = [{ from: 8, to: 9, text: 'Y' }]
    fixture.session.applyEdits(edits)
    const after = fixture.session.getTextSnapshot()
    fixture.setContext({ snapshot: after })

    fixture.folds.update(createTextEditBatch(before, after, edits))
    fixture.folds.schedule()
    fixture.folds.flush()

    expect(fixture.folds.index?.snapshot).toBe(after)
    expect(fixture.folds.index?.all()).toMatchObject([{ startLine: 0, endLine: 1 }])
    expect(fixture.folds.index?.diagnostics.coldReason).toBeTruthy()
    expect(fixture.folds.index?.diagnostics.factBlocksReused).toBe(0)
  })

  it('leaves no delayed work after an ordinary edit reuses its fold topology', () => {
    const fixture = controller('root\n  child\nnext')
    fixture.folds.flush()
    const before = fixture.session.getTextSnapshot()
    const edits = [{ from: 8, to: 8, text: 'x' }]
    fixture.session.applyEdits(edits)
    const after = fixture.session.getTextSnapshot()
    fixture.setContext({ snapshot: after, documentVersion: 2 })

    fixture.folds.update(createTextEditBatch(before, after, edits))
    fixture.folds.schedule()

    expect(fixture.folds.index?.snapshot).toBe(after)
    expect(fixture.folds.index?.all()).toMatchObject([{ startLine: 0, endLine: 1 }])
    expect(fixture.scheduler.has('editor.fallbackFolds')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    expect(fixture.logs).toContainEqual(
      expect.objectContaining({ trigger: 'edit', outcome: 'reused' }),
    )
  })

  it('does not read diagnostics when no diagnostic sink or logger consumes them', () => {
    vi.stubGlobal('__EDITOR_PERFORMANCE_DIAGNOSTICS__', null)
    const diagnostics = vi.spyOn(IndentationFoldIndex.prototype, 'diagnostics', 'get')
    const fixture = controller('root\n  child\nnext')
    fixture.setLoggingEnabled(false)

    fixture.folds.flush()
    const before = fixture.session.getTextSnapshot()
    const edits = [{ from: 8, to: 8, text: 'x' }]
    fixture.session.applyEdits(edits)
    const after = fixture.session.getTextSnapshot()
    fixture.setContext({ snapshot: after, documentVersion: 2 })
    fixture.folds.update(createTextEditBatch(before, after, edits))

    expect(fixture.folds.index?.all()).toMatchObject([{ startLine: 0, endLine: 1 }])
    expect(diagnostics).not.toHaveBeenCalled()
    expect(fixture.logs).toEqual([])
  })

  it('reports diagnostics once when recording is enabled without a logger', () => {
    const record = vi.fn()
    vi.stubGlobal('__EDITOR_PERFORMANCE_DIAGNOSTICS__', record)
    const diagnostics = vi.spyOn(IndentationFoldIndex.prototype, 'diagnostics', 'get')
    const fixture = controller('root\n  child\nnext')
    fixture.setLoggingEnabled(false)

    fixture.folds.flush()

    expect(diagnostics).toHaveBeenCalledTimes(1)
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'editor.fallbackFoldRanges',
        detail: expect.objectContaining({
          trigger: 'explicit-command',
          outcome: 'completed',
          rowsRead: 3,
          foldCount: 1,
          materializations: 0,
        }),
      }),
    )
    expect(fixture.logs).toEqual([])
  })
})

function controller(text: string) {
  const session = createDocumentSession(text)
  const scheduler = new EditorSecondaryWorkScheduler()
  const published: Array<IndentationFoldIndex | null> = []
  const logs: Readonly<Record<string, unknown>>[] = []
  let loggingEnabled = true
  let context: Context = {
    snapshot: session.getTextSnapshot(),
    documentId: 'fold-controller',
    documentVersion: 1,
    languageId: 'typescript',
    tabSize: 4,
    active: true,
    grammarProjectionSuppression: false,
    selection: {
      reason: 'no-session',
      provider: null,
      foldingSupport: null,
      structuralStatus: 'plain',
      structuralSession: false,
      structuralSuppression: false,
      configurationGeneration: 0,
    },
  }
  const folds = new EditorFallbackFoldController({
    scheduler,
    context: () => context,
    publish: (index) => published.push(index),
    changed: () => undefined,
    loggingEnabled: () => loggingEnabled,
    log: (detail) => logs.push(detail),
  })
  const dispose = () => {
    folds.reset()
    scheduler.dispose()
  }
  disposers.push(dispose)
  return {
    folds,
    scheduler,
    session,
    published,
    logs,
    dispose,
    context: () => context,
    setLoggingEnabled: (enabled: boolean) => {
      loggingEnabled = enabled
    },
    setContext: (next: Partial<Context>) => {
      context = { ...context, ...next }
    },
  }
}
