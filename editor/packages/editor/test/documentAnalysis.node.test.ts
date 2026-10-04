import { describe, expect, it, vi } from 'vitest'
import { createEditorBufferSession, createEditorTextBuffer } from '../src/documentSession'
import { createEditorDocumentAnalysis } from '../src/editor/documentAnalysis'
import { EditorTokenStore } from '../src/syntax/tokenStore'
import type { EditorHighlighterProvider } from '../src/syntax/highlighter'
import {
  createEmptySyntaxResult,
  createEmptySyntaxSession,
  type EditorSyntaxProvider,
  type EditorSyntaxRange,
  type EditorSyntaxResult,
} from '../src/syntax/session'

describe('retained document analysis', () => {
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
        createSession: () => ({
          ...createEmptySyntaxSession(),
          dispose: created++ === 0 ? disposeFirst : disposeSecond,
        }),
      }
      const refresh = async () => ({ tokens: EditorTokenStore.empty() })
      const highlighter: EditorHighlighterProvider = {
        createSession: () => {
          const first = created++ === 0
          return {
            refresh,
            applyChange: refresh,
            dispose: first ? disposeFirst : disposeSecond,
            onDidChangeTheme: first ? firstTheme : secondTheme,
          }
        },
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
      createSession: () => ({
        refresh,
        applyChange: refresh,
        dispose,
        onDidChangeTheme: (listener) => {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
      }),
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

  it('applies every captured event when a preceding listener commits a newer head', async () => {
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
      parser.edits.mock.calls.map(([change]) => change.textSnapshot.materializeFullText()),
    ).toEqual(['ab', 'abc'])
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
    expect(parser.ranges).toHaveBeenCalledExactlyOnceWith(range)
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
    expect(parser.ranges).toHaveBeenCalledExactlyOnceWith(range)
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
    expect(parser.ranges).toHaveBeenLastCalledWith({ startIndex: 0, endIndex: 4 })
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
    const createSession = vi.fn(() => ({ refresh, applyChange: refresh, dispose }))
    const request = { provider: { createSession }, languageId: 'markdown' }
    const first = analysis.borrowHighlighter(request)!
    await expect(first.refresh(buffer.getTextSnapshot())).rejects.toThrow('provider unavailable')
    const second = analysis.borrowHighlighter({ ...request, signal: abort.signal })!
    expect(createSession).toHaveBeenCalledTimes(1)
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
      createSession: () => ({
        refresh,
        applyChange: refresh,
        dispose: () => undefined,
        onDidChangeTheme: (listener) => {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
      }),
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
  const edits = vi.fn(async (_change: import('../src/documentSession').DocumentSessionChange) =>
    createEmptySyntaxResult(),
  )
  const ranges = vi.fn(async (range: EditorSyntaxRange) =>
    createEmptySyntaxResult({ requestedRanges: [range] }),
  )
  const create = vi.fn(() => ({
    foldingSupport: 'supported' as const,
    refresh: () => initial ?? Promise.resolve(createEmptySyntaxResult()),
    applyChange: edits,
    queryRange: ranges,
    canQueryRange,
    getResult: () => createEmptySyntaxResult(),
    getTokens: () => [],
    getSnapshotVersion: () => 1,
    dispose,
  }))
  return {
    provider: { createSession: create } satisfies EditorSyntaxProvider,
    create,
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
