import type { DocumentRead } from '../src/editor/documentDelivery'
import {
  createEditorHighlighterOperation,
  createEditorStructuralOperation,
} from '../src/editor/operationDefinitions'
import { describe, expect, it, vi } from 'vitest'
import { createEditorBufferSession, createEditorTextBuffer } from '../src/documentSession'
import {
  createEditorDocumentAnalysis,
  retainedSyntaxCanWarm,
  setRetainedSyntaxDisplayDemand,
} from '../src/editor/documentAnalysis'
import { EditorTokenStore } from '../src/syntax/tokenStore'
import type { EditorHighlighterProvider } from '../src/syntax/highlighter'
import {
  createEmptySyntaxResult,
  type EditorSyntaxProvider,
  type EditorSyntaxRuntime,
  type EditorSyntaxRange,
  type EditorSyntaxResult,
} from '../src/syntax/session'

describe('active range retention', () => {
  it.each(['cancelled', 'partial', 'range-unavailable'] as const)(
    'returns an unusable %s reply without retaining it as range coverage',
    async (kind) => {
      const buffer = createEditorTextBuffer('alpha beta')
      const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'incomplete-range' })
      const parser = provider()
      const range = { startIndex: 0, endIndex: 5 }
      const incomplete = createEmptySyntaxResult({ requestedRanges: [range] })
      const result: EditorSyntaxResult = {
        ...incomplete,
        degraded: kind === 'range-unavailable' ? { kind: 'range-unavailable' } : null,
        projection: {
          ...incomplete.projection,
          analysis:
            kind === 'cancelled'
              ? {
                  kind,
                  reason: 'budget',
                  coveredRange: { startIndex: 0, endIndex: 0 },
                  elapsedMs: 20_001,
                  budgetMs: 20_000,
                }
              : {
                  kind: 'partial',
                  coveredRange: { startIndex: 0, endIndex: kind === 'partial' ? 3 : 5 },
                },
        },
      }
      parser.ranges.mockResolvedValueOnce(result)
      const lease = analysis.borrowStructural({
        provider: parser.provider,
        languageId: 'typescript',
      })!
      try {
        expect(await lease.queryRange(range)).toBe(result)
        expect(analysis.inspectRetention().entries[0]?.cachedRangeCount).toBe(0)
        expect(lease.read(range).kind).toBe('pending')
        const recovered = await lease.queryRange({ startIndex: 0, endIndex: 3 })
        expect(recovered).not.toBe(result)
        expect(parser.ranges).toHaveBeenCalledTimes(2)
        expect(analysis.inspectRetention().entries[0]?.cachedRangeCount).toBe(1)
      } finally {
        lease.dispose()
        analysis.dispose()
      }
    },
  )

  it('keeps optional retirement on the source generation across compatible lease reborrow', async () => {
    const fixture = await optionalRetirementFixture()
    const { analysis, buffer, request, lease, current, optional } = fixture
    try {
      setRetainedSyntaxDisplayDemand(lease, current.demand, [current.contributor], [optional])
      expect(retainedSyntaxCanWarm(lease)).toBe(false)
      expect(typeof fixture.sourceState().stoppedWarmGeneration).toBe('number')
      expect(fixture.sourceState().stoppedWarmGeneration).toBe(fixture.sourceState().generation)
      const id = lease.runtimeSessionId
      const before = fixture.ranges.mock.calls.length
      lease.dispose()
      const warm = analysis.borrowStructural(request)!
      expect(warm.runtimeSessionId).toBe(id)
      expect(retainedSyntaxCanWarm(warm)).toBe(false)
      expect(warm.read(current.contributor.range).kind).toBe('ready')
      await warm.queryRange(current.contributor.range)
      expect(fixture.ranges).toHaveBeenCalledTimes(before)

      createEditorBufferSession(buffer).applyText('!')
      await warm.refresh(buffer.getTextSnapshot())
      expect(retainedSyntaxCanWarm(warm)).toBe(true)
      expect(fixture.sourceState().stoppedWarmGeneration).not.toBe(fixture.sourceState().generation)
      setRetainedSyntaxDisplayDemand(
        warm,
        { kind: 'frame', snapshot: buffer.getTextSnapshot(), ranges: [current.contributor.range] },
        [],
        [optional],
      )
      expect(retainedSyntaxCanWarm(warm)).toBe(true)
      warm.dispose()
    } finally {
      analysis.dispose()
    }
  })

  it('keeps an installed current copy contributor out of optional retirement', async () => {
    const { analysis, lease, current, optional } = await optionalRetirementFixture()
    try {
      setRetainedSyntaxDisplayDemand(
        lease,
        current.demand,
        [current.contributor, optional],
        [optional],
      )
      expect(retainedSyntaxCanWarm(lease)).toBe(true)
      expect(lease.read(optional.range).kind).toBe('ready')
      setRetainedSyntaxDisplayDemand(lease, current.demand, [current.contributor], [optional])
      expect(retainedSyntaxCanWarm(lease)).toBe(false)
    } finally {
      lease.dispose()
      analysis.dispose()
    }
  })

  it.each(['frame', 'preparation', 'unknown', 'unmanaged', 'contributor', 'waiter'] as const)(
    'preserves shared %s interest before marking optional retirement',
    async (pin) => {
      const fixture = await optionalRetirementFixture()
      const { analysis, buffer, request, lease, current, optional } = fixture
      const other = analysis.borrowStructural(request)!
      const gate = deferred<EditorSyntaxResult>()
      let pending: Promise<EditorSyntaxResult> | null = null
      try {
        if (pin === 'unknown') other.setDisplayDemand({ kind: 'unknown' })
        if (pin === 'frame' || pin === 'preparation')
          other.setDisplayDemand({
            kind: pin,
            snapshot: buffer.getTextSnapshot(),
            ranges: [optional.range],
          })
        if (pin === 'contributor')
          setRetainedSyntaxDisplayDemand(other, current.demand, [current.contributor, optional])
        if (pin === 'waiter') {
          setRetainedSyntaxDisplayDemand(other, current.demand, [current.contributor])
          fixture.ranges.mockImplementationOnce(() => gate.promise)
          pending = other.queryRange({ startIndex: 105, endIndex: 125 })
          await vi.waitFor(() =>
            expect(analysis.inspectRetention().entries[0]!.pendingRangeCount).toBe(1),
          )
        }

        setRetainedSyntaxDisplayDemand(lease, current.demand, [current.contributor], [optional])
        expect(retainedSyntaxCanWarm(lease)).toBe(true)
        expect(retainedSyntaxCanWarm(other)).toBe(true)
        gate.resolve(createEmptySyntaxResult())
        await pending
        setRetainedSyntaxDisplayDemand(other, current.demand, [current.contributor], [optional])
        expect(retainedSyntaxCanWarm(lease)).toBe(false)
      } finally {
        gate.resolve(createEmptySyntaxResult())
        await pending
        other.dispose()
        lease.dispose()
        analysis.dispose()
      }
    },
  )

  it('reopens optional work after a same-revision retry generation and configuration replacement', async () => {
    const fixture = await optionalRetirementFixture()
    const { analysis, buffer, request, lease, current, optional } = fixture
    try {
      setRetainedSyntaxDisplayDemand(lease, current.demand, [current.contributor], [optional])
      expect(retainedSyntaxCanWarm(lease)).toBe(false)
      fixture.retry()
      await lease.refresh(buffer.getTextSnapshot())
      expect(retainedSyntaxCanWarm(lease)).toBe(true)
      setRetainedSyntaxDisplayDemand(lease, current.demand, [current.contributor], [optional])
      expect(retainedSyntaxCanWarm(lease)).toBe(true)
      const changed = analysis.borrowStructural({ ...request, includeCaptures: true })!
      await changed.refresh(buffer.getTextSnapshot())
      expect(changed.runtimeSessionId).not.toBe(lease.runtimeSessionId)
      expect(retainedSyntaxCanWarm(changed)).toBe(true)
      changed.dispose()
      lease.dispose()
      analysis.reclaimInactive({ reason: 'inactive-budget' })
      expect(retainedSyntaxCanWarm(lease)).toBe(false)
      expect(fixture.sourceState().stoppedWarmGeneration).toBeNull()
      const recreated = analysis.borrowStructural(request)!
      expect(recreated.runtimeSessionId).not.toBe(lease.runtimeSessionId)
      expect(retainedSyntaxCanWarm(recreated)).toBe(true)
      recreated.dispose()
    } finally {
      analysis.dispose()
    }
  })

  it('releases the actual private lease binding when its signal closes', () => {
    const buffer = createEditorTextBuffer('alpha')
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'lease-binding' })
    const original = WeakMap.prototype.set
    const observed: { map: WeakMap<WeakKey, unknown> | null } = { map: null }
    const capture = (map: WeakMap<WeakKey, unknown>, value: unknown) => {
      if (
        typeof value !== 'object' ||
        value === null ||
        !('entry' in value) ||
        !('signal' in value)
      )
        return
      if (value.signal instanceof AbortSignal) observed.map = map
    }
    WeakMap.prototype.set = function (
      this: WeakMap<WeakKey, unknown>,
      key: WeakKey,
      value: unknown,
    ) {
      capture(this, value)
      return original.call(this, key, value)
    }
    let lease: ReturnType<typeof analysis.borrowStructural> = null
    try {
      lease = analysis.borrowStructural({
        provider: { operation: createEditorStructuralOperation(() => emptyStructuralRuntime()) },
        languageId: 'typescript',
      })
    } finally {
      WeakMap.prototype.set = original
    }
    const binding = observed.map
    if (!binding || !lease) throw new TypeError('Controlled lease binding observation unavailable')
    try {
      expect(binding.has(lease)).toBe(true)
      lease.dispose()
      expect(binding.has(lease)).toBe(false)
      analysis.reclaimInactive({ reason: 'inactive-budget' })
      expect(binding.has(lease)).toBe(false)
      expect(analysis.inspectRetention().entries).toEqual([])
    } finally {
      analysis.dispose()
    }
  })

  it('joins the current retry generation while the obsolete queued query settles', async () => {
    const buffer = createEditorTextBuffer('alpha')
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'retry-head' })
    const result = createEmptySyntaxResult()
    let refreshes = 0
    const ranges = vi.fn(async () => result)
    const provider = {
      operation: createEditorStructuralOperation(() => ({
        ...emptyStructuralRuntime(),
        analyze: async () => {
          if (++refreshes === 1) throw new TypeError('Controlled first refresh failure')
          return result
        },
        queryRange: ranges,
      })),
    }
    const lease = analysis.borrowStructural({ provider, languageId: 'typescript' })!
    await expect(lease.refresh(buffer.getTextSnapshot())).rejects.toBeInstanceOf(TypeError)
    const obsolete = lease.queryRange({ startIndex: 0, endIndex: 5 })
    const rejected = expect(obsolete).rejects.toMatchObject({ name: 'AbortError' })
    const retry = lease.refresh(buffer.getTextSnapshot())
    const current = lease.queryRange({ startIndex: 0, endIndex: 5 })
    expect(await Promise.all([retry, current])).toEqual([result, result])
    await rejected
    expect(ranges).toHaveBeenCalledTimes(1)
    expect(analysis.inspectRetention().entries[0]!.pendingRangeCount).toBe(0)
    analysis.dispose()
  })

  it.each(['disjoint', 'overlap'] as const)(
    'bounds forty %s ready ranges by both views actual contributors',
    async (mode) => {
      const buffer = createEditorTextBuffer('x'.repeat(100_000))
      const analysis = createEditorDocumentAnalysis({ buffer, documentId: mode })
      const parser = provider()
      const request = { provider: parser.provider, languageId: 'typescript' }
      const left = analysis.borrowStructural(request)!
      const right = analysis.borrowStructural(request)!
      const snapshot = buffer.getTextSnapshot()
      const first = { startIndex: 0, endIndex: 512 }
      const firstResult = await left.queryRange(first)
      setRetainedSyntaxDisplayDemand(left, { kind: 'frame', snapshot, ranges: [first] }, [
        { range: first, result: firstResult },
      ])
      const overlapFrame = { startIndex: 50_064, endIndex: 50_576 }
      let finalRange = first
      for (let step = 0; step < 40; step++) {
        const range =
          mode === 'overlap'
            ? { startIndex: 50_000 - step, endIndex: 51_024 + step }
            : { startIndex: (step + 1) * 1024, endIndex: (step + 1) * 1024 + 512 }
        const frame = mode === 'overlap' ? overlapFrame : range
        setRetainedSyntaxDisplayDemand(right, { kind: 'frame', snapshot, ranges: [frame] }, [])
        const result = await right.queryRange(range)
        setRetainedSyntaxDisplayDemand(right, { kind: 'frame', snapshot, ranges: [frame] }, [
          { range, result },
        ])
        expect(left.read(first)).toMatchObject({ kind: 'ready', result: firstResult })
        expect(right.read(frame)).toMatchObject({ kind: 'ready', result })
        expect(analysis.inspectRetention().entries[0]!.cachedRangeCount).toBe(2)
        finalRange = range
      }
      expect(left.runtimeSessionId).toBe(right.runtimeSessionId)
      expect(parser.create).toHaveBeenCalledTimes(1)
      left.dispose()
      right.dispose()
      const before = parser.ranges.mock.calls.length
      const warm = analysis.borrowStructural(request)!
      expect(warm.read(finalRange).kind).toBe('ready')
      await warm.queryRange(finalRange)
      expect(parser.ranges).toHaveBeenCalledTimes(before)
      analysis.dispose()
    },
  )

  it.each(['canceled-only', 'late-visible-survivor'] as const)(
    'keeps one provider operation with %s and qualified cache admission',
    async (mode) => {
      const buffer = createEditorTextBuffer('x'.repeat(100))
      const analysis = createEditorDocumentAnalysis({ buffer, documentId: mode })
      const parser = provider()
      const gate = deferred<EditorSyntaxResult>()
      parser.ranges.mockImplementationOnce(() => gate.promise)
      const request = { provider: parser.provider, languageId: 'typescript' }
      const left = analysis.borrowStructural(request)!
      const right = analysis.borrowStructural(request)!
      const snapshot = buffer.getTextSnapshot()
      const frame = { startIndex: 0, endIndex: 10 }
      const range = { startIndex: 50, endIndex: 60 }
      setRetainedSyntaxDisplayDemand(left, { kind: 'frame', snapshot, ranges: [frame] }, [])
      setRetainedSyntaxDisplayDemand(right, { kind: 'frame', snapshot, ranges: [frame] }, [])
      const abort = new AbortController()
      const canceled = left.queryRange(range, { signal: abort.signal })
      const rejected = expect(canceled).rejects.toMatchObject({ name: 'AbortError' })
      await vi.waitFor(() => expect(parser.ranges).toHaveBeenCalledTimes(1))
      abort.abort()
      await rejected
      expect(analysis.inspectRetention().entries[0]).toMatchObject({
        pendingRangeCount: 1,
        displayDemand: { queryWaiters: 0 },
      })
      let survivor: Promise<EditorSyntaxResult> | null = null
      if (mode === 'late-visible-survivor') {
        setRetainedSyntaxDisplayDemand(right, { kind: 'frame', snapshot, ranges: [range] }, [])
        survivor = right.queryRange(range)
      }
      const result = createEmptySyntaxResult({ requestedRanges: [range] })
      gate.resolve(result)
      if (survivor) expect(await survivor).toBe(result)
      await vi.waitFor(() =>
        expect(analysis.inspectRetention().entries[0]!.pendingRangeCount).toBe(0),
      )
      expect(parser.ranges).toHaveBeenCalledTimes(1)
      expect(analysis.inspectRetention().entries[0]!.cachedRangeCount).toBe(survivor ? 1 : 0)
      analysis.dispose()
    },
  )

  it.each(['unmanaged', 'unknown', 'foreign', 'stale', 'preparation'] as const)(
    'preserves %s protection',
    async (mode) => {
      const buffer = createEditorTextBuffer('x'.repeat(100))
      const analysis = createEditorDocumentAnalysis({ buffer, documentId: mode })
      const parser = provider()
      const lease = analysis.borrowStructural({
        provider: parser.provider,
        languageId: 'typescript',
      })!
      const snapshot = buffer.getTextSnapshot()
      const range = { startIndex: 20, endIndex: 30 }
      if (mode === 'unknown') lease.setDisplayDemand({ kind: 'unknown' })
      if (mode === 'foreign')
        lease.setDisplayDemand({
          kind: 'frame',
          snapshot: createEditorTextBuffer('foreign').getTextSnapshot(),
          ranges: [],
        })
      if (mode === 'stale') {
        lease.setDisplayDemand({ kind: 'frame', snapshot, ranges: [] })
        createEditorBufferSession(buffer).applyText('!')
      }
      if (mode === 'preparation')
        lease.setDisplayDemand({ kind: 'preparation', snapshot, ranges: [range] })
      await lease.queryRange(range)
      expect(analysis.inspectRetention().entries[0]!.cachedRangeCount).toBe(1)
      analysis.dispose()
    },
  )
})

describe('analysis retention notifications', () => {
  it.each(['structural', 'highlighter'] as const)(
    'releases empty buffer membership when aborted %s construction cleanup throws',
    (family) => {
      const buffer = createEditorTextBuffer('alpha')
      const subscribe = buffer.subscribe.bind(buffer)
      const releases = vi.fn()
      buffer.subscribe = (listener) => {
        const release = subscribe(listener)
        return () => {
          releases()
          release()
        }
      }
      const analysis = createEditorDocumentAnalysis({ buffer, documentId: `${family}-cleanup` })
      const abort = new AbortController()
      const listener = vi.fn()
      analysis.subscribeRetention(listener)
      const failure = new TypeError('Controlled external constructor cleanup failure')
      const dispose = vi.fn(() => {
        throw failure
      })
      const structural = {
        operation: createEditorStructuralOperation(() => {
          abort.abort()
          return { ...emptyStructuralRuntime(), dispose }
        }),
      }
      const highlighter = {
        operation: createEditorHighlighterOperation(() => {
          abort.abort()
          const refresh = async () => ({ tokens: EditorTokenStore.empty() })
          return { analyze: refresh, dispose }
        }),
      }
      const request = { languageId: null, signal: abort.signal }
      let observed: unknown
      try {
        if (family === 'structural') analysis.borrowStructural({ ...request, provider: structural })
        if (family === 'highlighter')
          analysis.borrowHighlighter({ ...request, provider: highlighter })
      } catch (error) {
        observed = error
      }
      expect(observed).toBe(failure)
      expect(analysis.inspectRetention().entries).toEqual([])
      expect(dispose).toHaveBeenCalledTimes(1)
      expect(releases).toHaveBeenCalledTimes(1)
      expect(listener).not.toHaveBeenCalled()
      analysis.dispose()
      expect(releases).toHaveBeenCalledTimes(1)
    },
  )

  it.each(['structural', 'highlighter'] as const)(
    'discards %s sessions when construction disposes the owner or aborts the request',
    async (family) => {
      for (const action of ['ordinary', 'dispose-owner', 'abort-request'] as const) {
        const buffer = createEditorTextBuffer('alpha')
        const analysis = createEditorDocumentAnalysis({ buffer, documentId: `${family}-${action}` })
        const abort = new AbortController()
        const listener = vi.fn()
        analysis.subscribeRetention(listener)
        const dispose = vi.fn()
        const construct = () => {
          if (action === 'dispose-owner') analysis.dispose()
          if (action === 'abort-request') abort.abort()
        }
        const structural = {
          operation: createEditorStructuralOperation(() => {
            construct()
            return { ...emptyStructuralRuntime(), dispose }
          }),
        }
        const highlighter = {
          operation: createEditorHighlighterOperation(() => {
            construct()
            const refresh = async () => ({ tokens: EditorTokenStore.empty() })
            return { analyze: refresh, dispose }
          }),
        }
        const request = { languageId: null, signal: abort.signal }
        const lease =
          family === 'structural'
            ? analysis.borrowStructural({ ...request, provider: structural })
            : analysis.borrowHighlighter({ ...request, provider: highlighter })
        if (action === 'ordinary') {
          expect(lease).not.toBeNull()
          expect(analysis.inspectRetention().entries[0]!.leaseCount).toBe(1)
        }
        if (action !== 'ordinary') {
          expect(lease).toBeNull()
          expect(analysis.inspectRetention().entries).toEqual([])
          expect(listener).not.toHaveBeenCalled()
          expect(dispose).toHaveBeenCalledTimes(1)
        }
        lease?.dispose()
        analysis.dispose()
        await Promise.resolve()
        expect(analysis.inspectRetention().entries).toEqual([])
        expect(dispose).toHaveBeenCalledTimes(1)
      }
    },
  )

  it('releases a theme subscription returned after terminal construction', () => {
    const buffer = createEditorTextBuffer('alpha')
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'theme-terminal' })
    const dispose = vi.fn()
    const unsubscribe = vi.fn()
    const listener = vi.fn()
    analysis.subscribeRetention(listener)
    const refresh = async () => ({ tokens: EditorTokenStore.empty() })
    const lease = analysis.borrowHighlighter({
      languageId: null,
      provider: {
        operation: createEditorHighlighterOperation(() => ({
          analyze: refresh,
          dispose,
          onDidChangeTheme: () => {
            analysis.dispose()
            return unsubscribe
          },
        })),
      },
    })
    expect(lease).toBeNull()
    expect(analysis.inspectRetention().entries).toEqual([])
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(listener).not.toHaveBeenCalled()
  })

  it.each(['structural-dispose', 'highlighter-dispose', 'highlighter-unsubscribe'] as const)(
    'notifies settled removal when external %s cleanup throws',
    (boundary) => {
      const buffer = createEditorTextBuffer('alpha')
      const analysis = createEditorDocumentAnalysis({ buffer, documentId: boundary })
      const snapshots: ReturnType<typeof analysis.inspectRetention>[] = []
      analysis.subscribeRetention(() => snapshots.push(analysis.inspectRetention()))
      const fail = vi.fn(() => {
        throw new TypeError('Controlled external cleanup failure')
      })
      const dispose = vi.fn(boundary.endsWith('dispose') ? fail : () => undefined)
      const unsubscribe = vi.fn(boundary === 'highlighter-unsubscribe' ? fail : () => undefined)
      const refresh = async () => ({ tokens: EditorTokenStore.empty() })
      const lease = boundary.startsWith('structural')
        ? analysis.borrowStructural({
            languageId: null,
            provider: {
              operation: createEditorStructuralOperation(() => ({
                ...emptyStructuralRuntime(),
                dispose,
              })),
            },
          })
        : analysis.borrowHighlighter({
            languageId: null,
            provider: {
              operation: createEditorHighlighterOperation(() => ({
                analyze: refresh,
                dispose,
                onDidChangeTheme: () => unsubscribe,
              })),
            },
          })
      lease!.dispose()
      const before = snapshots.length
      expect(() => analysis.reclaimInactive({ reason: 'inactive-budget' })).toThrow(TypeError)
      expect(snapshots).toHaveLength(before + 1)
      expect(snapshots.at(-1)!.entries).toEqual([])
      expect(fail).toHaveBeenCalledTimes(1)
      expect(dispose).toHaveBeenCalledTimes(1)
      expect(unsubscribe).toHaveBeenCalledTimes(boundary === 'structural-dispose' ? 0 : 1)
      analysis.dispose()
    },
  )

  it('publishes settled shared leases, display demand, query interests and reclamation', async () => {
    const buffer = createEditorTextBuffer('alpha beta')
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'notifications.md' })
    const parser = provider()
    const gate = deferred<EditorSyntaxResult>()
    parser.ranges.mockImplementationOnce(() => gate.promise)
    const snapshots: ReturnType<typeof analysis.inspectRetention>[] = []
    const unsubscribe = analysis.subscribeRetention(() => {
      snapshots.push(analysis.inspectRetention())
    })
    const request = { provider: parser.provider, languageId: 'markdown' }
    const left = analysis.borrowStructural(request)!
    const abort = new AbortController()
    const right = analysis.borrowStructural({ ...request, signal: abort.signal })!
    expect(right.runtimeSessionId).toBe(left.runtimeSessionId)
    expect(parser.create).toHaveBeenCalledTimes(1)
    expect(snapshots.map((snapshot) => snapshot.entries[0]!.leaseCount)).toEqual([1, 2])
    const range = { startIndex: 0, endIndex: 5 }
    left.setDisplayDemand({ kind: 'frame', snapshot: buffer.getTextSnapshot(), ranges: [range] })
    right.setDisplayDemand({
      kind: 'preparation',
      snapshot: buffer.getTextSnapshot(),
      ranges: [range],
    })
    await left.refresh(buffer.getTextSnapshot())
    expect(snapshots.at(-1)!.entries[0]!.status).toBe('ready')
    const canceled = right.queryRange(range)
    const rejected = expect(canceled).rejects.toMatchObject({ name: 'AbortError' })
    const survivor = left.queryRange(range)
    await vi.waitFor(() => expect(parser.ranges).toHaveBeenCalledTimes(1))
    expect(snapshots.at(-1)!.entries[0]!.displayDemand.queryWaiters).toBe(2)
    abort.abort()
    await rejected
    expect(snapshots.at(-1)!.entries[0]).toMatchObject({
      leaseCount: 1,
      displayDemand: { frames: 1, preparationLeases: 0, queryWaiters: 1 },
    })
    gate.resolve(createEmptySyntaxResult({ requestedRanges: [range] }))
    await survivor
    expect(snapshots.at(-1)!.entries[0]).toMatchObject({
      cachedRangeCount: 1,
      pendingRangeCount: 0,
      displayDemand: { queryWaiters: 0 },
    })
    left.dispose()
    expect(snapshots.at(-1)!.entries[0]).toMatchObject({
      leaseCount: 0,
      displayDemand: { frames: 0, preparationLeases: 0, unmanagedLeases: 0 },
    })
    analysis.reclaimInactive({ reason: 'inactive-budget' })
    expect(snapshots.at(-1)!.entries).toEqual([])
    for (const snapshot of snapshots) {
      for (const entry of snapshot.entries) {
        const demand = entry.displayDemand
        expect(entry.leaseCount).toBe(
          demand.frames + demand.preparationLeases + demand.unmanagedLeases + demand.unknownLeases,
        )
      }
    }
    unsubscribe()
    unsubscribe()
    analysis.dispose()
    expect(parser.dispose).toHaveBeenCalledTimes(1)
  })

  it('settles every retained entry before edit notifications', async () => {
    const buffer = createEditorTextBuffer('alpha')
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'settled.md' })
    const parser = provider()
    const first = analysis.borrowStructural({ provider: parser.provider, languageId: 'markdown' })!
    const second = analysis.borrowStructural({ provider: parser.provider, languageId: 'text' })!
    await Promise.all([
      first.refresh(buffer.getTextSnapshot()),
      second.refresh(buffer.getTextSnapshot()),
    ])
    const snapshots: ReturnType<typeof analysis.inspectRetention>[] = []
    analysis.subscribeRetention(() => snapshots.push(analysis.inspectRetention()))
    createEditorBufferSession(buffer).applyText('!')
    expect(snapshots).toHaveLength(1)
    expect(
      snapshots[0]!.entries.map(({ revision, status, resultCount }) => ({
        revision,
        status,
        resultCount,
      })),
    ).toEqual([
      { revision: 1, status: 'pending', resultCount: 0 },
      { revision: 1, status: 'pending', resultCount: 0 },
    ])
    await Promise.all([
      first.refresh(buffer.getTextSnapshot()),
      second.refresh(buffer.getTextSnapshot()),
    ])
    analysis.dispose()
  })

  it('isolates errors and supports independent, idempotent removal during bounded delivery', () => {
    const buffer = createEditorTextBuffer('alpha')
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'listeners.md' })
    const parser = provider()
    const duplicate = vi.fn()
    const first = analysis.subscribeRetention(duplicate)
    const second = analysis.subscribeRetention(duplicate)
    first()
    first()
    const lease = analysis.borrowStructural({ provider: parser.provider, languageId: 'markdown' })!
    expect(duplicate).toHaveBeenCalledTimes(1)
    second()
    const removed = vi.fn()
    let removeSelf: () => void = () => undefined
    let removeOther: () => void = () => undefined
    removeSelf = analysis.subscribeRetention(() => {
      removeSelf()
      removeOther()
    })
    removeOther = analysis.subscribeRetention(removed)
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    analysis.subscribeRetention(() => {
      throw new TypeError('Controlled external listener failure')
    })
    const snapshots: ReturnType<typeof analysis.inspectRetention>[] = []
    analysis.subscribeRetention(() => {
      analysis.reclaimInactive({ reason: 'inactive-budget' })
      snapshots.push(analysis.inspectRetention())
    })
    try {
      lease.dispose()
      expect(removed).not.toHaveBeenCalled()
      expect(snapshots).toHaveLength(1)
      expect(snapshots[0]!.entries).toEqual([])
      expect(report).toHaveBeenCalledTimes(1)
      expect(report.mock.calls[0]![1]).toBe('editor.analysis.retention_listener_failed')
    } finally {
      report.mockRestore()
      analysis.dispose()
    }
  })

  it('publishes failures and replacement, then detaches before terminal provider callbacks', async () => {
    const buffer = createEditorTextBuffer('alpha')
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'terminal.md' })
    const snapshots: ReturnType<typeof analysis.inspectRetention>[] = []
    analysis.subscribeRetention(() => snapshots.push(analysis.inspectRetention()))
    let created = 0
    let terminal = false
    const reentrantSnapshots: ReturnType<typeof analysis.inspectRetention>[] = []
    const highlighter: EditorHighlighterProvider = {
      operation: createEditorHighlighterOperation(() => {
        const id = ++created
        const refresh = async () => {
          if (id === 1) throw new TypeError('Controlled external provider failure')
          return { tokens: EditorTokenStore.empty() }
        }
        return {
          analyze: refresh,
          onDidChangeTheme: () => () => {
            if (!terminal) return
            analysis.subscribeRetention(() => snapshots.push(analysis.inspectRetention()))
            reentrantSnapshots.push(analysis.inspectRetention())
          },
          dispose: () => {
            if (!terminal) return
            analysis.borrowHighlighter({ provider: highlighter, languageId: null })
            createEditorBufferSession(buffer).applyText('!')
          },
        }
      }),
    }
    const request = { provider: highlighter, languageId: null }
    const failed = analysis.borrowHighlighter(request)!
    await expect(failed.refresh(buffer.getTextSnapshot())).rejects.toBeInstanceOf(TypeError)
    expect(snapshots.at(-1)!.entries[0]!.status).toBe('failed')
    failed.dispose()
    const replacement = analysis.borrowHighlighter(request)!
    expect(replacement.runtimeSessionId).not.toBe(failed.runtimeSessionId)
    expect(snapshots.at(-1)!.entries.map((entry) => entry.runtimeSessionId)).toEqual([
      replacement.runtimeSessionId,
    ])
    await replacement.refresh(buffer.getTextSnapshot())
    const before = snapshots.length
    terminal = true
    analysis.dispose()
    analysis.dispose()
    await Promise.resolve()
    expect(created).toBe(2)
    expect(reentrantSnapshots.map((snapshot) => snapshot.entries)).toEqual([[]])
    expect(snapshots).toHaveLength(before)
    expect(analysis.inspectRetention().entries).toEqual([])
  })

  it('keeps late completion silent after terminal disposal', async () => {
    const buffer = createEditorTextBuffer('alpha')
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'late.md' })
    const gate = deferred<EditorSyntaxResult>()
    const parser = provider(gate.promise)
    const listener = vi.fn()
    analysis.subscribeRetention(listener)
    const lease = analysis.borrowStructural({ provider: parser.provider, languageId: 'markdown' })!
    const pending = lease.refresh(buffer.getTextSnapshot())
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    const before = listener.mock.calls.length
    analysis.dispose()
    await rejected
    gate.resolve(createEmptySyntaxResult())
    await Promise.resolve()
    await Promise.resolve()
    expect(listener).toHaveBeenCalledTimes(before)
    expect(analysis.inspectRetention().entries).toEqual([])
    expect(parser.dispose).toHaveBeenCalledTimes(1)
  })
})

describe('retained document analysis', () => {
  it.each([
    'ordinary',
    'terminal-unsubscribe',
    'survivor-unsubscribe',
    'survivor-dispose',
  ] as const)(
    'replaces failed inactive highlighters safely through %s callbacks',
    async (boundary) => {
      const buffer = createEditorTextBuffer('alpha')
      const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'reborrow.md' })
      const disposed: number[] = []
      let created = 0
      const survivor: { current: ReturnType<typeof analysis.borrowHighlighter> } = { current: null }
      let reentered = false
      const reenter = () => {
        if (reentered) return
        reentered = true
        if (boundary === 'terminal-unsubscribe') {
          analysis.dispose()
          return
        }
        survivor.current = analysis.borrowHighlighter({ provider, languageId: 'markdown' })
      }
      const provider: EditorHighlighterProvider = {
        operation: createEditorHighlighterOperation(() => {
          const id = ++created
          const refresh = async () => {
            if (id === 1) throw new TypeError('Controlled external provider failure')
            return { tokens: EditorTokenStore.empty() }
          }
          return {
            analyze: refresh,

            onDidChangeTheme: () => () => {
              if (id === 1 && boundary.endsWith('unsubscribe')) reenter()
            },
            dispose: () => {
              disposed.push(id)
              if (id === 1 && boundary === 'survivor-dispose') reenter()
            },
          }
        }),
      }
      const first = analysis.borrowHighlighter({ provider, languageId: 'markdown' })!
      await expect(first.refresh(buffer.getTextSnapshot())).rejects.toBeInstanceOf(TypeError)
      first.dispose()
      const replacement = analysis.borrowHighlighter({ provider, languageId: 'markdown' })
      if (boundary === 'terminal-unsubscribe') {
        expect(replacement).toBeNull()
        expect(created).toBe(1)
        expect(analysis.inspectRetention().entries).toEqual([])
      } else {
        expect(replacement).not.toBeNull()
        await replacement!.refresh(buffer.getTextSnapshot())
        expect(created).toBe(2)
        expect(analysis.inspectRetention().entries).toHaveLength(1)
        if (survivor.current)
          expect(replacement!.runtimeSessionId).toBe(survivor.current.runtimeSessionId)
      }
      analysis.dispose()
      expect(disposed).toEqual(boundary === 'terminal-unsubscribe' ? [1] : [1, 2])
      expect(analysis.inspectRetention().entries).toEqual([])
    },
  )

  it('keeps displayed, preparation and unmanaged leases separate from range queries', async () => {
    const buffer = createEditorTextBuffer('alpha beta gamma delta')
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'demand.md' })
    const parser = provider()
    const request = { provider: parser.provider, languageId: 'markdown' }
    const left = analysis.borrowStructural(request)!
    const right = analysis.borrowStructural(request)!
    const preparation = analysis.borrowStructural(request)!
    const external = analysis.borrowStructural(request)!
    const snapshot = buffer.getTextSnapshot()
    const first = { startIndex: 0, endIndex: 5 }
    const second = { startIndex: 6, endIndex: 10 }
    left.setDisplayDemand({ kind: 'frame', snapshot, ranges: [first] })
    right.setDisplayDemand({ kind: 'frame', snapshot, ranges: [second] })
    preparation.setDisplayDemand({ kind: 'preparation', snapshot, ranges: [first] })
    await left.queryRange({ startIndex: 11, endIndex: 16 })
    const inspect = () => analysis.inspectRetention().entries[0]!.displayDemand
    expect(inspect()).toEqual({
      unmanagedLeases: 1,
      unknownLeases: 0,
      frames: 2,
      ranges: [first, second],
      preparationLeases: 1,
      preparationRanges: [first],
      queryWaiters: 0,
      queryRanges: [],
    })
    left.setDisplayDemand({ kind: 'frame', snapshot, ranges: [second] })
    expect(inspect().ranges).toEqual([second, second])
    left.dispose()
    preparation.dispose()
    expect(inspect()).toMatchObject({ frames: 1, preparationLeases: 0, ranges: [second] })
    createEditorBufferSession(buffer).applyText('!')
    expect(inspect()).toMatchObject({ unmanagedLeases: 1, unknownLeases: 1, frames: 0, ranges: [] })
    external.dispose()
    right.setDisplayDemand({ kind: 'unknown' })
    expect(inspect()).toMatchObject({ unmanagedLeases: 0, unknownLeases: 1 })
    analysis.dispose()
  })

  it.each(['abort', 'lease-dispose'] as const)(
    'releases one %s waiter while another shares the same provider query',
    async (reason) => {
      const buffer = createEditorTextBuffer('alpha beta')
      const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'waiters.md' })
      const parser = provider()
      const gate = deferred<EditorSyntaxResult>()
      parser.ranges.mockImplementationOnce(() => gate.promise)
      const request = { provider: parser.provider, languageId: 'markdown' }
      const left = analysis.borrowStructural(request)!
      const right = analysis.borrowStructural(request)!
      await left.refresh(buffer.getTextSnapshot())
      const range = { startIndex: 0, endIndex: 5 }
      right.setDisplayDemand({ kind: 'frame', snapshot: buffer.getTextSnapshot(), ranges: [range] })
      const controller = new AbortController()
      const canceled = left.queryRange(range, { signal: controller.signal })
      const rejected = expect(canceled).rejects.toMatchObject({ name: 'AbortError' })
      const survivor = right.queryRange(range)
      await vi.waitFor(() => expect(parser.ranges).toHaveBeenCalledTimes(1))
      expect(analysis.inspectRetention().entries[0]!.displayDemand.queryWaiters).toBe(2)
      if (reason === 'abort') controller.abort()
      if (reason === 'lease-dispose') left.dispose()
      await rejected
      expect(analysis.inspectRetention().entries[0]!.displayDemand).toMatchObject({
        frames: 1,
        ranges: [range],
        queryWaiters: 1,
        queryRanges: [range],
      })
      const result = createEmptySyntaxResult({ requestedRanges: [range] })
      gate.resolve(result)
      expect(await survivor).toBe(result)
      expect(right.read(range)).toMatchObject({ kind: 'ready', result })
      expect(parser.ranges).toHaveBeenCalledTimes(1)
      expect(parser.create).toHaveBeenCalledTimes(1)
      expect(analysis.inspectRetention().entries[0]!.displayDemand.queryWaiters).toBe(0)
      analysis.dispose()
    },
  )

  it('queues captured nested publications before an earlier eager reader repairs the head', async () => {
    const buffer = createEditorTextBuffer('alpha')
    const view = createEditorBufferSession(buffer)
    const reads: Promise<unknown>[] = []
    let lease: ReturnType<ReturnType<typeof createEditorDocumentAnalysis>['borrowHighlighter']> =
      null
    buffer.subscribe((event) => {
      if (event.revisionAfter === 1) view.applyText('?')
      if (lease) reads.push(lease.applyChange(event.change))
    })
    const calls: string[] = []
    const provider: EditorHighlighterProvider = {
      operation: createEditorHighlighterOperation(() => ({
        analyze: async (snapshot) => {
          calls.push(`analyze:${snapshot.text.readRange(0, snapshot.text.length)}`)
          return { tokens: EditorTokenStore.empty() }
        },

        dispose: () => undefined,
      })),
    }
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'nested-eager.md' })
    lease = analysis.borrowHighlighter({ provider, languageId: 'markdown' })
    expect(lease).not.toBeNull()
    await lease!.refresh(buffer.getTextSnapshot())
    view.applyText('!')
    await Promise.all([...reads, lease!.refresh(buffer.getTextSnapshot())])
    expect(calls).toEqual(['analyze:alpha', 'analyze:alpha!?'])
    expect(lease!.read()).toMatchObject({ kind: 'ready', revision: 2 })
    analysis.dispose()
  })

  it.each(['caller-abort', 'owner-dispose'] as const)(
    'settles %s before the current-read publication boundary without a new session',
    async (reason) => {
      const buffer = createEditorTextBuffer('alpha')
      const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'microtask-cancel.md' })
      const gate = deferred<{ tokens: EditorTokenStore }>()
      const refresh = vi.fn(() => gate.promise)
      const dispose = vi.fn()
      const create = vi.fn(() => ({ analyze: refresh, dispose }))
      const provider: EditorHighlighterProvider = {
        operation: createEditorHighlighterOperation(create),
      }
      const interest = new AbortController()
      const lease = analysis.borrowHighlighter({
        provider,
        languageId: 'markdown',
        signal: interest.signal,
      })!
      const pending = lease.refresh(buffer.getTextSnapshot())
      const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      if (reason === 'caller-abort') interest.abort()
      if (reason === 'owner-dispose') analysis.dispose()
      await rejected
      gate.resolve({ tokens: EditorTokenStore.empty() })
      if (reason === 'caller-abort') {
        const survivor = analysis.borrowHighlighter({ provider, languageId: 'markdown' })!
        await survivor.refresh(buffer.getTextSnapshot())
        expect(survivor.read().kind).toBe('ready')
        survivor.dispose()
      }
      expect(lease.read().kind).toBe('failed')
      expect(create).toHaveBeenCalledTimes(1)
      analysis.dispose()
      expect(dispose).toHaveBeenCalledTimes(1)
    },
  )

  it('cancels running-generation interest when theme refresh supersedes it', async () => {
    const buffer = createEditorTextBuffer('alpha')
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'microtask-theme.md' })
    const gate = deferred<{ tokens: EditorTokenStore }>()
    const listeners = new Set<() => void>()
    const current = {
      tokens: EditorTokenStore.fromTokens([{ start: 0, end: 5, style: { color: 'new' } }]),
    }
    const started = deferred<void>()
    const refresh = vi
      .fn(() => Promise.resolve(current))
      .mockImplementationOnce(() => {
        started.resolve()
        return gate.promise
      })
    const provider: EditorHighlighterProvider = {
      operation: createEditorHighlighterOperation(() => ({
        analyze: refresh,

        dispose: () => undefined,
        onDidChangeTheme: (listener) => {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
      })),
    }
    const lease = analysis.borrowHighlighter({ provider, languageId: 'markdown' })!
    const old = lease.refresh(buffer.getTextSnapshot())
    const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' })
    await started.promise
    for (const listener of listeners) listener()
    await rejected
    gate.resolve({ tokens: EditorTokenStore.empty() })
    expect(await lease.refresh(buffer.getTextSnapshot())).toBe(current)
    expect(refresh).toHaveBeenCalledTimes(2)
    analysis.dispose()
  })

  it.each([
    ['structural-session', false],
    ['structural-session', true],
    ['highlighter-session', false],
    ['highlighter-session', true],
    ['highlighter-theme', false],
    ['highlighter-theme', true],
  ] as const)(
    'releases every owned session with %s callbacks and reclamation reentrancy %s',
    async (boundary, reentrant) => {
      const buffer = createEditorTextBuffer('alpha')
      const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'reentrant.md' })
      const listeners = new Set<() => void>()
      let reclaimed = false
      const reenter = () => {
        if (!reentrant || reclaimed) return
        reclaimed = true
        analysis.reclaimInactive({ reason: 'inactive-budget' })
        analysis.dispose()
      }
      const idle = () => undefined
      const disposeFirst = vi.fn(boundary === 'highlighter-theme' ? idle : reenter)
      const disposeSecond = vi.fn()
      const unsubscribeFirst = vi.fn(boundary === 'highlighter-theme' ? reenter : idle)
      const unsubscribeSecond = vi.fn()
      const firstTheme = (listener: () => void) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
          unsubscribeFirst()
        }
      }
      const secondTheme = (listener: () => void) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
          unsubscribeSecond()
        }
      }
      let created = 0
      const structural: EditorSyntaxProvider = {
        operation: createEditorStructuralOperation(() => ({
          ...emptyStructuralRuntime(),
          dispose: created++ === 0 ? disposeFirst : disposeSecond,
        })),
      }
      const refresh = async () => ({ tokens: EditorTokenStore.empty() })
      const highlighter: EditorHighlighterProvider = {
        operation: createEditorHighlighterOperation(() => {
          const first = created++ === 0
          return {
            analyze: refresh,

            dispose: first ? disposeFirst : disposeSecond,
            onDidChangeTheme: first ? firstTheme : secondTheme,
          }
        }),
      }
      const first =
        boundary === 'structural-session'
          ? analysis.borrowStructural({ provider: structural, languageId: 'markdown' })!
          : analysis.borrowHighlighter({ provider: highlighter, languageId: 'markdown' })!
      const survivor =
        boundary === 'structural-session'
          ? analysis.borrowStructural({
              provider: structural,
              languageId: 'markdown',
              configurationTag: ['survivor'],
            })!
          : analysis.borrowHighlighter({
              provider: highlighter,
              languageId: 'markdown',
              configurationTag: ['survivor'],
            })!
      await Promise.all([
        first.refresh(buffer.getTextSnapshot()),
        survivor.refresh(buffer.getTextSnapshot()),
      ])
      first.dispose()
      expect(survivor.read().kind).toBe('ready')
      expect(analysis.inspectRetention().entries).toHaveLength(2)
      analysis.dispose()

      expect(created).toBe(2)
      expect(disposeFirst).toHaveBeenCalledTimes(1)
      expect(disposeSecond).toHaveBeenCalledTimes(1)
      expect(listeners.size).toBe(0)
      expect(survivor.read().kind).toBe('failed')
      if (boundary !== 'structural-session') {
        expect(unsubscribeFirst).toHaveBeenCalledTimes(1)
        expect(unsubscribeSecond).toHaveBeenCalledTimes(1)
      }
      expect(analysis.inspectRetention().entries).toEqual([])
      expect(analysis.reclaimInactive({ reason: 'inactive-budget' }).runtimeSessionIds).toEqual([])
      analysis.dispose()
      expect(disposeFirst).toHaveBeenCalledTimes(1)
      expect(disposeSecond).toHaveBeenCalledTimes(1)
    },
  )

  it('calibrates retained configuration and range growth with two surviving view leases', async () => {
    const buffer = createEditorTextBuffer('alpha beta gamma delta '.repeat(10))
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'growth.md' })
    const parser = provider()
    const request = { provider: parser.provider, languageId: 'markdown' }
    const left = analysis.borrowStructural(request)!
    const right = analysis.borrowStructural(request)!
    const leftRange = { startIndex: 0, endIndex: 1 }
    const rightRange = { startIndex: 2, endIndex: 3 }
    const [leftResult, rightResult] = await Promise.all([
      left.queryRange!(leftRange),
      right.queryRange!(rightRange),
    ])
    const configurations: string[] = []
    for (let index = 0; index < 20; index++) {
      const lease = analysis.borrowStructural({ ...request, configurationTag: [index] })!
      configurations.push(lease.runtimeSessionId)
      await lease.refresh(buffer.getTextSnapshot())
      lease.dispose()
    }
    for (let index = 10; index < 50; index++) {
      await left.queryRange!({ startIndex: index, endIndex: index + 1 })
    }

    expect(parser.create).toHaveBeenCalledTimes(21)
    expect(parser.dispose).not.toHaveBeenCalled()
    for (let index = 10; index < 50; index++) {
      await left.queryRange!({ startIndex: index, endIndex: index + 1 })
    }
    expect(await left.queryRange!(leftRange)).toBe(leftResult)
    expect(right.getResult()).toBe(rightResult)
    expect(parser.ranges).toHaveBeenCalledTimes(42)
    const reopened = analysis.borrowStructural({ ...request, configurationTag: [0] })!
    expect(reopened.runtimeSessionId).toBe(configurations[0])
    expect(parser.create).toHaveBeenCalledTimes(21)
    reopened.dispose()
    left.dispose()
    expect(right.read(rightRange).kind).toBe('ready')
    analysis.dispose()
    expect(parser.dispose).toHaveBeenCalledTimes(21)
  })

  it('reclaims inactive configurations without releasing active views or text history', async () => {
    const buffer = createEditorTextBuffer('alpha beta')
    const view = createEditorBufferSession(buffer)
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'reclaim.md' })
    const parser = provider()
    const request = { provider: parser.provider, languageId: 'markdown' }
    const left = analysis.borrowStructural(request)!
    const right = analysis.borrowStructural(request)!
    await Promise.all([
      left.queryRange!({ startIndex: 0, endIndex: 5 }),
      right.queryRange!({ startIndex: 6, endIndex: 10 }),
    ])
    const old = analysis.borrowStructural({ ...request, configurationTag: ['old'] })!
    await old.queryRange!({ startIndex: 0, endIndex: 5 })
    old.dispose()
    view.applyText('!')
    await right.refresh(buffer.getTextSnapshot())
    const snapshot = buffer.getTextSnapshot()
    const revision = buffer.getRevision()

    expect(analysis.inspectRetention().entries).toHaveLength(2)
    expect(analysis.reclaimInactive({ reason: 'inactive-budget' }).runtimeSessionIds).toEqual([
      old.runtimeSessionId,
    ])
    expect(parser.dispose).toHaveBeenCalledTimes(1)
    expect(buffer.getTextSnapshot()).toBe(snapshot)
    expect(buffer.getRevision()).toBe(revision)
    expect(right.read().kind).toBe('ready')
    left.dispose()
    expect(analysis.reclaimInactive({ reason: 'inactive-budget' }).runtimeSessionIds).toEqual([])
    expect(right.read().kind).toBe('ready')
    right.dispose()
    expect(analysis.reclaimInactive({ reason: 'inactive-budget' }).runtimeSessionIds).toEqual([
      right.runtimeSessionId,
    ])
    expect(analysis.inspectRetention().entries).toEqual([])
    expect(parser.dispose).toHaveBeenCalledTimes(2)
    view.undo()
    expect(buffer.materializeFullText()).toBe('alpha beta')
    view.redo()
    expect(buffer.materializeFullText()).toBe('alpha beta!')
    const recreated = analysis.borrowStructural(request)!
    expect(recreated.runtimeSessionId).not.toBe(right.runtimeSessionId)
    await recreated.refresh(buffer.getTextSnapshot())
    expect(recreated.read()).toMatchObject({ kind: 'ready', revision: buffer.getRevision() })
    recreated.dispose()
    analysis.dispose()
    analysis.dispose()
    expect(parser.dispose).toHaveBeenCalledTimes(3)
  })

  it('inspects shared record backing without charging token or provider allocations', async () => {
    const buffer = createEditorTextBuffer('alpha beta')
    const backing = new ArrayBuffer(256)
    const tokens = EditorTokenStore.fromTokens([{ start: 0, end: 5, style: { color: 'red' } }])
    const result = {
      ...createEmptySyntaxResult(),
      records: { languageId: 'markdown', data: new Uint32Array(backing, 0, 4) },
      tokens,
    }
    const parser = provider(Promise.resolve(result))
    parser.ranges.mockResolvedValue({
      ...result,
      records: { languageId: 'markdown', data: new Uint32Array(backing, 16, 4) },
    })
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'backing.md' })
    const left = analysis.borrowStructural({ provider: parser.provider, languageId: 'markdown' })!
    const right = analysis.borrowStructural({
      provider: parser.provider,
      languageId: 'markdown',
      configurationTag: ['other'],
    })!
    await left.queryRange!({ startIndex: 0, endIndex: 5 })
    await right.refresh(buffer.getTextSnapshot())
    const inspection = analysis.inspectRetention()
    expect(inspection.entries).toMatchObject([
      {
        leaseCount: 1,
        resultCount: 2,
        tokenCount: 1,
        cachedRangeCount: 1,
        syntaxRecordBackingBytes: 256,
      },
      {
        leaseCount: 1,
        resultCount: 1,
        tokenCount: 1,
        cachedRangeCount: 0,
        syntaxRecordBackingBytes: 256,
      },
    ])
    expect(inspection.syntaxRecordBackingBytes).toBe(256)
    expect(inspection.unmeasuredBytes).toEqual([
      'token-store-backing',
      'javascript-objects',
      'provider-sessions',
      'worker-heaps',
      'wasm',
    ])
    left.dispose()
    expect(analysis.inspectRetention().entries[0]?.lastLeaseReleasedAt).toEqual(expect.any(Number))
    const receipt = analysis.reclaimInactive({ reason: 'inactive-budget' })
    expect(receipt).toMatchObject({
      runtimeSessionIds: [left.runtimeSessionId],
      cachedRangeCount: 1,
    })
    expect(analysis.inspectRetention().syntaxRecordBackingBytes).toBe(256)
    right.dispose()
    analysis.reclaimInactive({ reason: 'inactive-budget' })
    expect(analysis.inspectRetention().syntaxRecordBackingBytes).toBe(0)
    analysis.dispose()
  })

  it('preserves every cached range while any view still borrows the configuration', async () => {
    const buffer = createEditorTextBuffer('alpha beta gamma')
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'active-ranges.md' })
    const parser = provider()
    const request = { provider: parser.provider, languageId: 'markdown' }
    const left = analysis.borrowStructural(request)!
    const right = analysis.borrowStructural(request)!
    const first = { startIndex: 0, endIndex: 5 }
    const second = { startIndex: 6, endIndex: 10 }
    const leftResult = await left.queryRange!(first)
    const rightResult = await right.queryRange!(second)
    await left.queryRange!({ startIndex: 11, endIndex: 16 })
    left.dispose()

    expect(analysis.reclaimInactive({ reason: 'inactive-budget' }).runtimeSessionIds).toEqual([])
    expect(right.read(first)).toMatchObject({ kind: 'ready', result: leftResult })
    expect(right.read(second)).toMatchObject({ kind: 'ready', result: rightResult })
    expect(analysis.inspectRetention().entries).toMatchObject([
      { leaseCount: 1, cachedRangeCount: 3 },
    ])
    expect(parser.ranges).toHaveBeenCalledTimes(3)
    right.dispose()
    expect(analysis.reclaimInactive({ reason: 'inactive-budget' }).cachedRangeCount).toBe(3)
    expect(analysis.inspectRetention().entries).toEqual([])
    analysis.dispose()
  })

  it('selectively reclaims abandoned pending work and rejects late publication', async () => {
    const buffer = createEditorTextBuffer('alpha beta')
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'abandoned.md' })
    const ready = deferred<EditorSyntaxResult>()
    const parser = provider(ready.promise)
    const abandoned = analysis.borrowStructural({
      provider: parser.provider,
      languageId: 'markdown',
    })!
    const survivor = analysis.borrowStructural({
      provider: parser.provider,
      languageId: 'markdown',
      configurationTag: ['survivor'],
    })!
    const pending = abandoned.queryRange!({ startIndex: 0, endIndex: 5 })
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    abandoned.dispose()
    await rejected
    expect(
      analysis.reclaimInactive({
        reason: 'speculative-abandoned',
        runtimeSessionIds: [abandoned.runtimeSessionId, survivor.runtimeSessionId],
      }),
    ).toMatchObject({ runtimeSessionIds: [abandoned.runtimeSessionId], pendingRangeCount: 1 })
    expect(parser.dispose).toHaveBeenCalledTimes(1)
    ready.resolve(createEmptySyntaxResult())
    await survivor.refresh(buffer.getTextSnapshot())
    expect(abandoned.read().kind).toBe('failed')
    expect(analysis.inspectRetention().entries).toMatchObject([
      { runtimeSessionId: survivor.runtimeSessionId, leaseCount: 1 },
    ])
    survivor.dispose()
    expect(
      analysis.reclaimInactive({ reason: 'inactive-budget', runtimeSessionIds: [] })
        .runtimeSessionIds,
    ).toEqual([])
    analysis.dispose()
    expect(parser.dispose).toHaveBeenCalledTimes(2)
  })

  it('releases idle theme subscriptions and buffer subscriptions before recreating sessions', async () => {
    const buffer = createEditorTextBuffer('alpha beta')
    const subscribe = vi.spyOn(buffer, 'subscribe')
    const listeners = new Set<() => void>()
    const refresh = vi.fn(async () => ({ tokens: EditorTokenStore.empty() }))
    const dispose = vi.fn()
    const highlighter: EditorHighlighterProvider = {
      operation: createEditorHighlighterOperation(() => ({
        analyze: refresh,

        dispose,
        onDidChangeTheme: (listener) => {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
      })),
    }
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'subscriptions.md' })
    const request = { provider: highlighter, languageId: 'markdown' }
    for (let cycle = 0; cycle < 20; cycle++) {
      const lease = analysis.borrowHighlighter(request)!
      await lease.refresh(buffer.getTextSnapshot())
      lease.dispose()
      expect(listeners.size).toBe(1)
      expect(analysis.inspectRetention().entries).toHaveLength(1)
      expect(Reflect.get(buffer, 'subscribers')).toBe(1)
      analysis.reclaimInactive({ reason: 'inactive-budget' })
      expect(listeners.size).toBe(0)
      expect(analysis.inspectRetention().entries).toEqual([])
      expect(Reflect.get(buffer, 'subscribers')).toBe(0)
      expect(dispose).toHaveBeenCalledTimes(cycle + 1)
      expect(subscribe).toHaveBeenCalledTimes(cycle + 1)
      analysis.reclaimInactive({ reason: 'inactive-budget' })
      expect(dispose).toHaveBeenCalledTimes(cycle + 1)
    }
    analysis.dispose()
    expect(dispose).toHaveBeenCalledTimes(20)
  })

  it('coalesces computation while composing every captured edit to the committed target', async () => {
    const buffer = createEditorTextBuffer('a')
    const view = createEditorBufferSession(buffer)
    buffer.subscribe((event) => {
      if (event.revisionAfter === 1) view.applyText('c')
    })
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'nested.md' })
    const parser = provider()
    const lease = analysis.borrowStructural({ provider: parser.provider, languageId: 'markdown' })!
    await lease.refresh(buffer.getTextSnapshot())
    view.applyText('b')
    await lease.refresh(buffer.getTextSnapshot())
    expect(
      parser.edits.mock.calls.map(([read]) => read.text.readRange(0, read.text.length)),
    ).toEqual(['abc'])
    expect(parser.transitions.mock.calls[0][0]?.edits).toEqual([{ from: 1, to: 1, text: 'bc' }])
    const state = lease.read()
    expect(state.kind).toBe('ready')
    if (state.kind === 'ready') expect(state.snapshot.materializeFullText()).toBe('abc')
    analysis.dispose()
  })

  it('settles superseded interest while an older provider request is still running', async () => {
    const buffer = createEditorTextBuffer('alpha')
    const view = createEditorBufferSession(buffer)
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'superseded.md' })
    const gate = deferred<EditorSyntaxResult>()
    const parser = provider(gate.promise)
    const lease = analysis.borrowStructural({ provider: parser.provider, languageId: 'markdown' })!
    const old = lease.refresh(buffer.getTextSnapshot())
    const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' })
    await parser.started
    view.applyText('!')
    await rejected
    expect(lease.read()).toMatchObject({ kind: 'pending', revision: 1 })
    gate.resolve(createEmptySyntaxResult())
    await lease.refresh(buffer.getTextSnapshot())
    expect(parser.edits).toHaveBeenCalledTimes(1)
    analysis.dispose()
  })

  it('shares unchanged configuration values and separates each effective structural option', async () => {
    const buffer = createEditorTextBuffer('alpha')
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'options.md' })
    const parser = provider()
    const request = {
      provider: parser.provider,
      languageId: 'markdown',
      configurationTag: ['theme', 1],
    }
    const first = analysis.borrowStructural(request)!
    const second = analysis.borrowStructural({ ...request, configurationTag: ['theme', 1] })!
    expect(second.runtimeSessionId).toBe(first.runtimeSessionId)
    for (const option of [
      { includeCaptures: false },
      { includeHighlights: false },
      { syntaxMode: 'range' as const },
    ]) {
      const different = analysis.borrowStructural({ ...request, ...option })!
      expect(different.runtimeSessionId).not.toBe(first.runtimeSessionId)
      different.dispose()
    }
    expect(parser.create).toHaveBeenCalledTimes(4)
    analysis.dispose()
    expect(parser.dispose).toHaveBeenCalledTimes(4)
  })

  it('releases document sessions once per open/close cycle without disposing the shared provider', async () => {
    const parser = provider()
    for (let cycle = 0; cycle < 20; cycle++) {
      const buffer = createEditorTextBuffer('alpha')
      const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'reopened.md' })
      const lease = analysis.borrowStructural({
        provider: parser.provider,
        languageId: 'markdown',
      })!
      await lease.refresh(buffer.getTextSnapshot())
      lease.dispose()
      analysis.dispose()
      analysis.dispose()
      expect(parser.dispose).toHaveBeenCalledTimes(cycle + 1)
    }
    expect(parser.create).toHaveBeenCalledTimes(20)
  })

  it('shares a parser and applies each committed revision once across detached views', async () => {
    const buffer = createEditorTextBuffer('alpha beta')
    const view = createEditorBufferSession(buffer)
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'a.md' })
    const parser = provider()
    const left = analysis.borrowStructural({ provider: parser.provider, languageId: 'markdown' })!
    const right = analysis.borrowStructural({ provider: parser.provider, languageId: 'markdown' })!
    await Promise.all([
      left.refresh(buffer.getTextSnapshot()),
      right.refresh(buffer.getTextSnapshot()),
    ])
    expect(parser.create).toHaveBeenCalledTimes(1)
    left.dispose()
    view.applyEdits([{ from: 0, to: 5, text: 'gamma' }])
    await right.refresh(buffer.getTextSnapshot())
    expect(parser.edits).toHaveBeenCalledTimes(1)
    right.dispose()
    view.undo()
    const reopened = analysis.borrowStructural({
      provider: parser.provider,
      languageId: 'markdown',
    })!
    await reopened.refresh(buffer.getTextSnapshot())
    expect(parser.create).toHaveBeenCalledTimes(1)
    expect(parser.edits).toHaveBeenCalledTimes(2)
    expect(reopened.read()).toMatchObject({ kind: 'ready', revision: buffer.getRevision() })
    expect(parser.dispose).not.toHaveBeenCalled()
    analysis.dispose()
    analysis.dispose()
    expect(parser.dispose).toHaveBeenCalledTimes(1)
  })

  it('retains independent ranges and shares requests for the same current range', async () => {
    const buffer = createEditorTextBuffer('alpha beta gamma')
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'ranges.md' })
    const parser = provider()
    const left = analysis.borrowStructural({ provider: parser.provider, languageId: 'markdown' })!
    const right = analysis.borrowStructural({ provider: parser.provider, languageId: 'markdown' })!
    const first = { startIndex: 0, endIndex: 5 }
    const second = { startIndex: 6, endIndex: 10 }
    const [a, b] = await Promise.all([left.queryRange!(first), right.queryRange!(second)])
    expect(left.getResult()).toBe(a)
    expect(right.getResult()).toBe(b)
    left.dispose()
    expect(await right.queryRange!(first)).toBe(a)
    expect(parser.ranges).toHaveBeenCalledTimes(2)
    analysis.dispose()
  })

  it('preserves provider range readiness while a full result is retained', async () => {
    const buffer = createEditorTextBuffer('alpha beta')
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'range-capability.md' })
    let rangeReady = false
    const parser = provider(undefined, () => rangeReady)
    const lease = analysis.borrowStructural({ provider: parser.provider, languageId: 'markdown' })!
    const result = await lease.refresh(buffer.getTextSnapshot())
    const range = { startIndex: 0, endIndex: 5 }

    expect(lease.canQueryRange?.()).toBe(false)
    expect(lease.read(range)).toMatchObject({ kind: 'ready', result })
    expect(await lease.queryRange!(range)).toBe(result)
    expect(parser.ranges).not.toHaveBeenCalled()

    rangeReady = true
    expect(lease.canQueryRange?.()).toBe(true)
    expect(lease.read(range).kind).toBe('pending')
    await lease.queryRange!(range)
    expect(parser.ranges).toHaveBeenCalledExactlyOnceWith(range, expect.any(AbortSignal))
    expect(lease.read(range).kind).toBe('ready')
    analysis.dispose()
  })

  it('keeps a completed base fallback out of the bounded range cache', async () => {
    const buffer = createEditorTextBuffer('alpha beta')
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'pending-capability.md' })
    const ready = deferred<EditorSyntaxResult>()
    let rangeReady = false
    const parser = provider(ready.promise, () => rangeReady)
    const lease = analysis.borrowStructural({ provider: parser.provider, languageId: 'markdown' })!
    const range = { startIndex: 0, endIndex: 5 }
    const pending = lease.queryRange!(range)
    const result = createEmptySyntaxResult()
    ready.resolve(result)

    expect(await pending).toBe(result)
    expect(parser.ranges).not.toHaveBeenCalled()
    rangeReady = true
    expect(lease.read(range).kind).toBe('pending')
    await lease.queryRange!(range)
    expect(parser.ranges).toHaveBeenCalledExactlyOnceWith(range, expect.any(AbortSignal))
    analysis.dispose()
  })

  it('clips retained viewport demand when an edit shortens the document', async () => {
    const buffer = createEditorTextBuffer('alpha beta gamma')
    const view = createEditorBufferSession(buffer)
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'shorter.md' })
    const parser = provider()
    const lease = analysis.borrowStructural({ provider: parser.provider, languageId: 'markdown' })!
    await lease.queryRange!({ startIndex: 0, endIndex: 16 })
    const change = view.applyEdits([{ from: 0, to: 16, text: 'docs' }])
    const result = await lease.applyChange(change)
    expect(parser.ranges).toHaveBeenLastCalledWith(
      { startIndex: 0, endIndex: 4 },
      expect.any(AbortSignal),
    )
    expect(await lease.queryRange!({ startIndex: 0, endIndex: 4 })).toBe(result)
    expect(lease.read({ startIndex: 0, endIndex: 16 })).toMatchObject({ kind: 'ready', result })
    analysis.dispose()
  })

  it('cancels hover interest immediately while a view still waits for the same parser', async () => {
    const buffer = createEditorTextBuffer('alpha')
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'hover.md' })
    const ready = deferred<EditorSyntaxResult>()
    const parser = provider(ready.promise)
    const hover = new AbortController()
    const first = analysis.borrowStructural({
      provider: parser.provider,
      languageId: 'markdown',
      signal: hover.signal,
    })!
    const second = analysis.borrowStructural({ provider: parser.provider, languageId: 'markdown' })!
    const abandoned = first.refresh(buffer.getTextSnapshot())
    const wanted = second.refresh(buffer.getTextSnapshot())
    hover.abort()
    await expect(abandoned).rejects.toMatchObject({ name: 'AbortError' })
    expect(parser.dispose).not.toHaveBeenCalled()
    ready.resolve(createEmptySyntaxResult())
    await wanted
    expect(second.read().kind).toBe('ready')
    analysis.dispose()
  })

  it('rejects an old revision and admits only the committed current revision', async () => {
    const buffer = createEditorTextBuffer('alpha')
    const view = createEditorBufferSession(buffer)
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'stale.md' })
    const ready = deferred<EditorSyntaxResult>()
    const parser = provider(ready.promise)
    const lease = analysis.borrowStructural({ provider: parser.provider, languageId: 'markdown' })!
    const old = lease.refresh(buffer.getTextSnapshot())
    await parser.started
    view.applyEdits([{ from: 0, to: 5, text: 'beta' }])
    ready.resolve(createEmptySyntaxResult())
    await expect(old).rejects.toMatchObject({ name: 'AbortError' })
    await lease.refresh(buffer.getTextSnapshot())
    expect(lease.read()).toMatchObject({ kind: 'ready', revision: 1 })
    expect(parser.edits).toHaveBeenCalledTimes(1)
    analysis.dispose()
  })

  it('settles pending interest on owner disposal and rejects late publication', async () => {
    const buffer = createEditorTextBuffer('alpha')
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'closed.md' })
    const ready = deferred<EditorSyntaxResult>()
    const parser = provider(ready.promise)
    const lease = analysis.borrowStructural({ provider: parser.provider, languageId: 'markdown' })!
    const pending = lease.refresh(buffer.getTextSnapshot())
    analysis.dispose()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    ready.resolve(createEmptySyntaxResult())
    await Promise.resolve()
    expect(lease.read().kind).toBe('failed')
    expect(
      analysis.borrowStructural({ provider: parser.provider, languageId: 'markdown' }),
    ).toBeNull()
    expect(parser.dispose).toHaveBeenCalledTimes(1)
  })

  it('partitions incompatible provider configurations without disturbing another view', async () => {
    const buffer = createEditorTextBuffer('alpha')
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'configuration.md' })
    const parser = provider()
    const first = analysis.borrowStructural({
      provider: parser.provider,
      languageId: 'markdown',
      configurationTag: ['a'],
    })!
    const second = analysis.borrowStructural({
      provider: parser.provider,
      languageId: 'markdown',
      configurationTag: ['b'],
    })!
    await Promise.all([
      first.refresh(buffer.getTextSnapshot()),
      second.refresh(buffer.getTextSnapshot()),
    ])
    expect(first.runtimeSessionId).not.toBe(second.runtimeSessionId)
    expect(parser.create).toHaveBeenCalledTimes(2)
    analysis.dispose()
    expect(parser.dispose).toHaveBeenCalledTimes(2)
  })

  it('does not reuse a visible range reply after its source changes', async () => {
    const buffer = createEditorTextBuffer('alpha beta')
    const view = createEditorBufferSession(buffer)
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'range-edit.md' })
    const parser = provider()
    const pendingRange = deferred<EditorSyntaxResult>()
    parser.ranges.mockImplementationOnce(() => pendingRange.promise)
    const lease = analysis.borrowStructural({ provider: parser.provider, languageId: 'markdown' })!
    await lease.refresh(buffer.getTextSnapshot())
    const range = { startIndex: 0, endIndex: 5 }
    const old = lease.queryRange!(range)
    await vi.waitFor(() => expect(parser.ranges).toHaveBeenCalledTimes(1))
    view.applyEdits([{ from: 0, to: 5, text: 'gamma' }])
    pendingRange.resolve(createEmptySyntaxResult())
    await expect(old).rejects.toMatchObject({ name: 'AbortError' })
    expect(lease.read(range).kind).toBe('pending')
    await lease.queryRange!(range)
    expect(parser.ranges).toHaveBeenCalledTimes(2)
    expect(lease.read(range)).toMatchObject({ kind: 'ready', revision: 1 })
    analysis.dispose()
  })

  it('keeps failed shared highlighters alive until every view releases its lease', async () => {
    const buffer = createEditorTextBuffer('alpha')
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'shared.md' })
    const abort = new AbortController()
    let failing = true
    const refresh = async () => {
      if (failing) throw new Error('provider unavailable')
      return { tokens: EditorTokenStore.empty() }
    }
    const dispose = vi.fn()
    const createOperation = vi.fn(() => ({ analyze: refresh, dispose }))
    const request = {
      provider: { operation: createEditorHighlighterOperation(createOperation) },
      languageId: 'markdown',
    }
    const first = analysis.borrowHighlighter(request)!
    await expect(first.refresh(buffer.getTextSnapshot())).rejects.toThrow('provider unavailable')
    const second = analysis.borrowHighlighter({ ...request, signal: abort.signal })!
    expect(createOperation).toHaveBeenCalledTimes(1)
    expect(dispose).not.toHaveBeenCalled()
    failing = false
    await second.refresh(buffer.getTextSnapshot())
    expect(first.read().kind).toBe('ready')
    abort.abort()
    second.dispose()
    expect(first.read().kind).toBe('ready')
    analysis.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('refreshes retained highlighter results when the provider theme changes', async () => {
    const buffer = createEditorTextBuffer('alpha')
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'theme.md' })
    const listeners = new Set<() => void>()
    let color = 'first'
    const refresh = vi.fn(async () => ({
      tokens: EditorTokenStore.fromTokens([{ start: 0, end: 5, style: { color } }]),
    }))
    const highlighter: EditorHighlighterProvider = {
      operation: createEditorHighlighterOperation(() => ({
        analyze: refresh,

        dispose: () => undefined,
        onDidChangeTheme: (listener) => {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
      })),
    }
    const lease = analysis.borrowHighlighter({ provider: highlighter, languageId: 'markdown' })!
    await lease.refresh(buffer.getTextSnapshot())
    lease.onDidChangeTheme?.(() => undefined)
    color = 'second'
    for (const listener of listeners) listener()
    const current = await lease.refresh(buffer.getTextSnapshot())
    expect(current.tokens.toTokens()[0]?.style.color).toBe('second')
    expect(refresh).toHaveBeenCalledTimes(2)
    lease.dispose()
    expect(listeners.size).toBe(1)
    analysis.dispose()
    expect(listeners.size).toBe(0)
  })
})

function provider(initial?: Promise<EditorSyntaxResult>, canQueryRange?: () => boolean) {
  const dispose = vi.fn()
  const edits = vi.fn(async (_read: DocumentRead) => createEmptySyntaxResult())
  const ranges = vi.fn(async (range: EditorSyntaxRange) =>
    createEmptySyntaxResult({ requestedRanges: [range] }),
  )
  const started = deferred<void>()
  const transitions = vi.fn(
    (_change: import('../src/editor/editChain').DocumentChangesSinceSyncPoint | null) => {},
  )
  const create = vi.fn(
    (context: import('../src/document/operations').EditorStructuralOperationContext) => {
      let initialized = false
      let previous: DocumentRead | null = null
      return {
        foldingSupport: 'supported' as const,
        analyze: (read: DocumentRead) => {
          const changes = previous
            ? context.source.changesBetween(previous.revision, read.revision)
            : null
          previous = read
          if (initialized) {
            transitions(changes)
            return edits(read)
          }
          initialized = true
          started.resolve()
          return initial ?? Promise.resolve(createEmptySyntaxResult())
        },

        queryRange: ranges,
        canQueryRange,
        getResult: () => createEmptySyntaxResult(),
        getTokens: () => [],
        getSnapshotVersion: () => 1,
        dispose,
      }
    },
  )
  return {
    provider: { operation: createEditorStructuralOperation(create) } satisfies EditorSyntaxProvider,
    create,
    started: started.promise,
    transitions,
    edits,
    ranges,
    dispose,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

function emptyStructuralRuntime(): EditorSyntaxRuntime {
  return {
    analyze: async () => createEmptySyntaxResult(),
    foldingSupport: 'unsupported',
    getResult: createEmptySyntaxResult,
    getTokens: () => [],
    getSnapshotVersion: () => 0,
    dispose: () => {},
  }
}

async function optionalRetirementFixture() {
  const buffer = createEditorTextBuffer('x'.repeat(500))
  const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'optional-source' })
  const session = provider()
  const request = {
    provider: session.provider,
    languageId: 'typescript',
    syntaxMode: 'range' as const,
    includeCaptures: false,
  }
  const lease = analysis.borrowStructural(request)!
  const currentRange = { startIndex: 0, endIndex: 20 }
  const optionalRange = { startIndex: 100, endIndex: 120 }
  const currentResult = await lease.queryRange(currentRange)
  const optionalResult = await lease.queryRange(optionalRange)
  const current = {
    contributor: { range: currentRange, result: currentResult },
    demand: { kind: 'frame' as const, snapshot: buffer.getTextSnapshot(), ranges: [currentRange] },
  }
  const optional = { range: optionalRange, result: optionalResult }
  setRetainedSyntaxDisplayDemand(lease, current.demand, [current.contributor, optional])
  const binding: {
    retry: (() => void) | null
    sourceState: (() => { generation: unknown; stoppedWarmGeneration: unknown }) | null
  } = { retry: null, sourceState: null }
  const original = WeakMap.prototype.get
  WeakMap.prototype.get = function (this: WeakMap<WeakKey, unknown>, key: WeakKey) {
    const value = original.call(this, key)
    if (key !== lease || typeof value !== 'object' || value === null || !('entry' in value))
      return value
    const entry = value.entry
    if (typeof entry !== 'object' || entry === null || !('refresh' in entry)) return value
    const refresh = entry.refresh
    if (typeof refresh === 'function') binding.retry = () => refresh.call(entry)
    binding.sourceState = () => ({
      generation: Reflect.get(entry, 'generation'),
      stoppedWarmGeneration: Reflect.get(entry, 'stoppedWarmGeneration'),
    })
    return value
  }
  try {
    retainedSyntaxCanWarm(lease)
  } finally {
    WeakMap.prototype.get = original
  }
  if (!binding.retry || !binding.sourceState)
    throw new TypeError('Controlled source generation unavailable')
  return {
    analysis,
    buffer,
    request,
    lease,
    current,
    optional,
    ranges: session.ranges,
    retry: binding.retry,
    sourceState: binding.sourceState,
  }
}
